# chaperone-lm — Project Guide for AI Assistants

## What this project is

An OpenAI-compatible LLM gateway. It exposes `POST /v1/chat/completions` and `GET /v1/models` and routes requests to any configured backend provider. Clients need no knowledge of the underlying provider.

## Commands

```bash
yarn install                    # install dependencies
yarn dev                        # start with hot-reload (tsx)
yarn build                      # compile TypeScript to dist/
yarn start                      # run compiled output
yarn test                       # unit tests (vitest)
yarn test:integration           # integration tests (requires provider credentials)
yarn lint                       # eslint
yarn lint:fix                   # eslint --fix
yarn format                     # prettier --write
yarn format:check               # prettier --check
yarn tsc --noEmit               # type check only
```

Run a single integration test file:
```bash
source .env
yarn test:integration src/adapters/__integration__/anthropic.integration.test.ts
```

## Architecture

```
src/
  index.ts              # entry point — loads config, builds registry, starts Express
  server.ts             # createApp() — wires routes to Express
  types.ts              # ChannelConfig, ModelConfig, AppConfig, ResolvedRoute
  config/
    loader.ts           # reads config.yaml, resolves $ENV_VAR refs, validates with zod
    schema.ts           # zod schemas for config validation
  routing/
    resolver.ts         # resolveRoute() — maps model alias → channel + adapter
  adapters/
    types.ts            # ProviderAdapter interface, GatewayRequest, AdapterRequestError
    registry.ts         # buildAdapterRegistry() — one adapter instance per channel
    anthropic.ts        # AnthropicAdapter
    openai.ts           # OpenAIAdapter
    google.ts           # GoogleAdapter
    azure.ts            # AzureAdapter
    vertex.ts           # VertexAdapter
    bedrock.ts          # BedrockAdapter
    openai-compatible.ts# OpenAICompatibleAdapter
    *.test.ts           # unit tests per adapter
    __integration__/    # integration tests (require live credentials)
      helpers/
        providerSuite.ts# runProviderSuite() — shared 6-test suite for all providers
  pipeline/
    serialize.ts        # converts AI SDK stream to OpenAI SSE / JSON format
  routes/
    chat.ts             # POST /v1/chat/completions handler
    models.ts           # GET /v1/models handler
```

## Key concepts

**Request lifecycle** (in `src/routes/chat.ts`):
1. `resolveRoute` — look up model alias → channel config + adapter
2. `adapter.transformRequest` — per-provider request normalisation (runs before `createModel`)
3. `adapter.createModel` — constructs the AI SDK model object
4. `streamText` (AI SDK) — calls the provider
5. `serializeResponse` — converts to OpenAI wire format (streaming or non-streaming)

**ProviderAdapter interface** (`src/adapters/types.ts`):
- `transformRequest(req)` — normalise the incoming request; return `AdapterRequestError` to short-circuit with an HTTP error
- `transformResponse(stream)` — post-process the response stream (currently a passthrough for all adapters)
- `createModel(channelConfig, modelId, deploymentId?)` — return an AI SDK `LanguageModel`

**Important:** `transformRequest` is called **before** `createModel` on every request. Adapters must not rely on state set by `createModel`. The `VertexAdapter` uses constructor injection to pass the provider type, because `buildAdapterRegistry` creates one adapter instance per channel at startup.

**Config format** (`config.yaml`):
```yaml
channels:
  my-channel:
    type: anthropic       # determines which adapter is used
    apiKey: $ENV_VAR      # values starting with $ are resolved from env

models:
  my-alias:
    channel: my-channel   # must match a channel key
    model: claude-haiku-4-5
    deploymentId: ...     # optional, used by Azure
```

## Provider notes

- **Vertex `anthropic` backend** — Claude models are only servable in `us-east5`, not `us-central1`. Pass `region: us-east5` in the channel config.
- **Vertex `anthropic` backend** — `AnthropicAdapter.transformRequest` is delegated to for system message merging, `reasoning_effort` mapping, and forced `temperature: 1`.
- **Azure** — `resourceName` is the subdomain prefix only (e.g. `my-resource-314d8`), not a full URL. Use `.chat(deploymentId)` not `(modelId)` directly — v3.x of `@ai-sdk/azure` defaults to the Responses API otherwise.
- **Azure AI Foundry serverless** — uses the `openai-compatible` adapter. `baseUrl` must end in `/models`.
- **Bedrock** — uses AWS credentials from the environment; no API key in config.
- **o1/o3/o4 models (OpenAI and Azure)** — `max_tokens` is rewritten to `providerOptions.openai.maxCompletionTokens` and `temperature` is stripped.

## Testing

Unit tests live alongside each adapter (`*.test.ts`). Integration tests are in `src/adapters/__integration__/` and are skipped automatically when the required environment variable is absent.

The shared `runProviderSuite` function runs 6 tests against any adapter:
1. Non-streaming response
2. SSE streaming response
3. Multiple system messages
4. 404 for unknown model alias
5. Tool call (non-streaming)
6. Streaming tool call chunks

Tests 5 and 6 can be disabled per-backend with `supportsTools: false`.

## CI / workflows

- `ci.yml` — runs on every PR: type check, lint, format check, unit tests, integration tests (excludes Azure due to low-quota Foundry endpoint)
- `integration.yml` — nightly + manual dispatch; each provider is a separate step, individually selectable

## Yarn

This project uses Yarn 4 (`nodeLinker: node-modules`). The `packageManager` field in `package.json` pins the version. Use `corepack enable` if `yarn` is not available.
