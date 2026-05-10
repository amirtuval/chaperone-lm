# CVE Mitigation Log

## 2026-05-10 — Moderate vulnerabilities in vitest/vite/esbuild (dev dependencies)

**Affected packages:** `vitest`, `vite`, `vite-node`, `@vitest/mocker`, `esbuild`
**Severity:** Moderate
**Scope:** Dev dependencies only — not present in production runtime

**Details:** `npm audit` reports moderate vulnerabilities in the `esbuild` → `vite` → `vitest` chain.
These packages are used exclusively as dev/test tooling and are not bundled into or executed
by the production server. No user data or runtime is exposed.

**Action:** No immediate fix applied. `npm audit fix --force` would require breaking version
changes to vitest. Monitor for a patched vitest release and upgrade when available.
