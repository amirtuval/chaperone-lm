# chaperone-lm

A lightweight LLM gateway that exposes an OpenAI-compatible API in front of multiple AI providers. Configure channels and model aliases in a single YAML file; any client that speaks the OpenAI chat completions protocol works without modification.

## How it works

The gateway translates between the OpenAI wire format and each provider's native SDK. A **channel** is a configured connection to a provider. A **model alias** maps a short name (what the client sends) to a channel and an upstream model ID. Per-provider request and response transforms are applied transparently.

## Supported providers

| Provider | Channel type | Auth |
|---|---|---|
| Anthropic | `anthropic` | API key |
| OpenAI | `openai` | API key |
| Google AI (Gemini) | `google` | API key |
| AWS Bedrock | `bedrock` | AWS credentials (env / IAM) |
| Google Vertex AI | `vertex` | Application Default Credentials / WIF |
| Azure OpenAI | `azure` | API key |
| Any OpenAI-compatible endpoint | `openai-compatible` | Optional API key |

## Configuration

The server reads a YAML file at startup (default: `./config.yaml`, override with `CONFIG_PATH`). Any value starting with `$` is treated as an environment variable reference and resolved at load time.

```yaml
channels:
  my-anthropic:
    type: anthropic
    apiKey: $ANTHROPIC_API_KEY

  my-openai:
    type: openai
    apiKey: $OPENAI_API_KEY

models:
  claude-sonnet:
    channel: my-anthropic
    model: claude-sonnet-4-6

  gpt-4o:
    channel: my-openai
    model: gpt-4o
```

### Channel reference

**`anthropic`**
```yaml
type: anthropic
apiKey: $ANTHROPIC_API_KEY
```

**`openai`**
```yaml
type: openai
apiKey: $OPENAI_API_KEY
```

**`google`**
```yaml
type: google
apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

**`bedrock`** — uses AWS credentials from the environment (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`, or an attached IAM role).
```yaml
type: bedrock
region: us-east-1
```

**`vertex`** — uses Application Default Credentials (`gcloud auth application-default login` locally, or Workload Identity Federation in CI).
```yaml
type: vertex
project: my-gcp-project
region: us-central1
provider: gemini   # gemini (default) | anthropic | maas
```

`provider` selects the Vertex backend:
- `gemini` — first-party Gemini models
- `anthropic` — Claude models via Model Garden (region `us-east5` required)
- `maas` — third-party models via Model-as-a-Service

**`azure`**
```yaml
type: azure
resourceName: my-resource-314d8   # subdomain prefix only, not a full URL
apiKey: $AZURE_OPENAI_API_KEY
```

**`openai-compatible`** — any endpoint that implements the OpenAI chat completions API (e.g. OpenRouter, Azure AI Foundry serverless, Ollama).
```yaml
type: openai-compatible
baseUrl: https://openrouter.ai/api/v1
apiKey: $OPENROUTER_API_KEY   # optional
```

### Model aliases

```yaml
models:
  my-alias:
    channel: channel-name      # must match a key under channels
    model: upstream-model-id   # model ID sent to the provider
    deploymentId: my-deploy    # optional — Azure deployment name override
```

## Running the server

```bash
yarn install
```

Start in development mode (hot-reload via `tsx`):
```bash
CONFIG_PATH=./config.yaml yarn dev
```

Build and start in production:
```bash
yarn build
CONFIG_PATH=./config.yaml yarn start
```

The server listens on port `3000` by default. Override with `PORT`.

## API

The gateway exposes two endpoints.

**`POST /v1/chat/completions`** — drop-in replacement for the OpenAI chat completions endpoint. Supports both streaming (`"stream": true`) and non-streaming responses. The `model` field must match a configured alias.

```bash
curl http://localhost:3000/v1/chat/completions 
  -H "Content-Type: application/json" 
  -d '{
    "model": "claude-sonnet",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**`GET /v1/models`** — returns the list of configured model aliases in OpenAI format.

```bash
curl http://localhost:3000/v1/models
```

## Example: multi-provider config

```yaml
channels:
  anthropic:
    type: anthropic
    apiKey: $ANTHROPIC_API_KEY

  openai:
    type: openai
    apiKey: $OPENAI_API_KEY

  bedrock:
    type: bedrock
    region: us-east-1

  vertex-gemini:
    type: vertex
    project: $GCP_PROJECT
    region: us-central1
    provider: gemini

  vertex-claude:
    type: vertex
    project: $GCP_PROJECT
    region: us-east5
    provider: anthropic

  openrouter:
    type: openai-compatible
    baseUrl: https://openrouter.ai/api/v1
    apiKey: $OPENROUTER_API_KEY

models:
  claude-haiku:
    channel: anthropic
    model: claude-haiku-4-5

  claude-sonnet:
    channel: anthropic
    model: claude-sonnet-4-6

  gpt-4o:
    channel: openai
    model: gpt-4o

  gpt-4o-mini:
    channel: openai
    model: gpt-4o-mini

  o4-mini:
    channel: openai
    model: o4-mini

  bedrock-sonnet:
    channel: bedrock
    model: us.anthropic.claude-sonnet-4-6

  gemini-flash:
    channel: vertex-gemini
    model: gemini-2.5-flash

  vertex-claude-sonnet:
    channel: vertex-claude
    model: claude-sonnet-4-6

  free-model:
    channel: openrouter
    model: google/gemini-2.0-flash-lite-001
```

## Development

```bash
yarn test                  # unit tests
yarn test:integration      # integration tests (requires provider credentials)
yarn lint
yarn format:check
yarn tsc --noEmit          # type check
```

Integration tests skip automatically when the required environment variables are not set. To run a specific provider's tests:

```bash
source .env
yarn test:integration src/adapters/__integration__/anthropic.integration.test.ts
```
