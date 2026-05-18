#!/usr/bin/env bash
# setup-wi.sh — Configure Workload Identity Federation for GitHub Actions
#
# This script provisions the GCP-side resources required for GitHub Actions
# to authenticate to GCP without long-lived service account keys.
#
# Prerequisites:
#   - gcloud CLI authenticated as a principal with the following roles on the project:
#       roles/iam.workloadIdentityPoolAdmin
#       roles/iam.serviceAccountAdmin
#       roles/resourcemanager.projectIamAdmin
#   - The target GitHub repo must be set via GITHUB_REPO (owner/name format)
#
# Usage:
#   GITHUB_REPO=amirtuval/chaperone-lm GCP_PROJECT=tabnine-dev bash .github/scripts/setup-wi.sh
#
# After running, add these as GitHub Actions secrets:
#   WI_PROVIDER   — the workload identity provider resource name (printed at end)
#   WI_SA_EMAIL   — the service account email (printed at end)

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

GCP_PROJECT="${GCP_PROJECT:-tabnine-dev}"
GITHUB_REPO="${GITHUB_REPO:-amirtuval/chaperone-lm}"

POOL_ID="github-actions-pool"
POOL_DISPLAY="GitHub Actions Pool"
PROVIDER_ID="github-oidc"
PROVIDER_DISPLAY="GitHub OIDC Provider"
SA_NAME="github-actions-vertex"
SA_DISPLAY="GitHub Actions — Vertex AI"

PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT" --format="value(projectNumber)")

echo "──────────────────────────────────────────────"
echo "Project:       $GCP_PROJECT ($PROJECT_NUMBER)"
echo "GitHub repo:   $GITHUB_REPO"
echo "Pool ID:       $POOL_ID"
echo "Provider ID:   $PROVIDER_ID"
echo "Service acct:  $SA_NAME"
echo "──────────────────────────────────────────────"

# ── 1. Enable required APIs ───────────────────────────────────────────────────

echo ""
echo "▶ Enabling required APIs..."
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com aiplatform.googleapis.com --project="$GCP_PROJECT"

# ── 2. Create Workload Identity Pool ─────────────────────────────────────────

echo ""
echo "▶ Creating Workload Identity Pool..."
if gcloud iam workload-identity-pools describe "$POOL_ID" --project="$GCP_PROJECT" --location=global &>/dev/null; then
  echo "  Pool '$POOL_ID' already exists — skipping."
else
  gcloud iam workload-identity-pools create "$POOL_ID" --project="$GCP_PROJECT" --location=global --display-name="$POOL_DISPLAY"
  echo "  Created pool '$POOL_ID'."
fi

# ── 3. Create OIDC Provider ───────────────────────────────────────────────────

echo ""
echo "▶ Creating OIDC Provider..."
if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --project="$GCP_PROJECT" --location=global --workload-identity-pool="$POOL_ID" &>/dev/null; then
  echo "  Provider '$PROVIDER_ID' already exists — skipping."
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" --project="$GCP_PROJECT" --location=global --workload-identity-pool="$POOL_ID" --display-name="$PROVIDER_DISPLAY" --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" --attribute-condition="assertion.repository == '${GITHUB_REPO}'"
  echo "  Created provider '$PROVIDER_ID'."
fi

# ── 4. Create Service Account ─────────────────────────────────────────────────

SA_EMAIL="${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"

echo ""
echo "▶ Creating service account..."
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$GCP_PROJECT" &>/dev/null; then
  echo "  Service account '$SA_EMAIL' already exists — skipping."
else
  gcloud iam service-accounts create "$SA_NAME" --project="$GCP_PROJECT" --display-name="$SA_DISPLAY"
  echo "  Created service account '$SA_EMAIL'."
fi

# ── 5. Grant Vertex AI roles to Service Account ───────────────────────────────

echo ""
echo "▶ Granting Vertex AI roles to service account..."
echo "  Waiting for service account to propagate..."
sleep 10  # IAM propagation can take up to 60 s; 10 s is sufficient in practice
gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:${SA_EMAIL}" --role="roles/aiplatform.user" --condition=None --quiet
echo "  Granted roles/aiplatform.user."

# ── 6. Allow the WI pool to impersonate the Service Account ───────────────────

echo ""
echo "▶ Binding Workload Identity Pool to service account..."
MEMBER="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$GCP_PROJECT" --role="roles/iam.workloadIdentityUser" --member="$MEMBER" --quiet
echo "  Bound '$GITHUB_REPO' → '$SA_EMAIL'."

# ── 7. Print outputs ──────────────────────────────────────────────────────────

WI_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo ""
echo "══════════════════════════════════════════════"
echo "✅ Workload Identity Federation setup complete."
echo ""
echo "Add these as GitHub Actions secrets:"
echo ""
echo "  WI_PROVIDER = ${WI_PROVIDER}"
echo "  WI_SA_EMAIL = ${SA_EMAIL}"
echo "══════════════════════════════════════════════"
