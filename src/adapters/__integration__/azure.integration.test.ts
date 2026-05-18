import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

// Azure OpenAI (gpt-4o, gpt-5.4) — authenticated via API key.
// Required env vars:
//   AZURE_OPENAI_RESOURCE_NAME   — e.g. "chaperone-lm-aoai"
//   AZURE_OPENAI_API_KEY         — Azure OpenAI key
//
// Azure AI Foundry serverless (Llama-3.3-70B) — openai-compatible adapter.
// Required env vars:
//   AZURE_AI_SERVICES_ENDPOINT   — e.g. "https://chaperone-lm-aiservices.services.ai.azure.com/"
//   AZURE_AI_SERVICES_API_KEY    — AI Services key

const RESOURCE_NAME = process.env.AZURE_OPENAI_RESOURCE_NAME
const AOAI_KEY = process.env.AZURE_OPENAI_API_KEY
const FOUNDRY_ENDPOINT = process.env.AZURE_AI_SERVICES_ENDPOINT
const FOUNDRY_KEY = process.env.AZURE_AI_SERVICES_API_KEY

const hasAoaiCredentials = Boolean(RESOURCE_NAME && AOAI_KEY)
const hasFoundryCredentials = Boolean(FOUNDRY_ENDPOINT && FOUNDRY_KEY)

function makeAoaiApp(channelName: string, modelAlias: string, deploymentId: string) {
  const config: AppConfig = {
    channels: [
      { name: channelName, type: 'azure', resourceName: RESOURCE_NAME!, apiKey: AOAI_KEY! },
    ],
    models: { [modelAlias]: { channel: channelName, model: modelAlias, deploymentId } },
  }
  return createApp(config, buildAdapterRegistry(config.channels))
}

function makeFoundryApp(channelName: string, modelAlias: string, modelId: string) {
  // Azure AI Foundry serverless models expose an OpenAI-compatible endpoint at
  // {endpoint}/models — the SDK appends /chat/completions automatically.
  const baseUrl = FOUNDRY_ENDPOINT!.replace(/\/$/, '') + '/models'
  const config: AppConfig = {
    channels: [{ name: channelName, type: 'openai-compatible', baseUrl, apiKey: FOUNDRY_KEY }],
    models: { [modelAlias]: { channel: channelName, model: modelId } },
  }
  return createApp(config, buildAdapterRegistry(config.channels))
}

describe.skipIf(!hasAoaiCredentials)('Azure OpenAI — gpt-4o — integration', () => {
  runProviderSuite({
    app: makeAoaiApp('azure-gpt4o', 'gpt-4o', 'gpt-4o'),
    modelAlias: 'gpt-4o',
    strictFinishReason: true,
  })
})

describe.skipIf(!hasAoaiCredentials)('Azure OpenAI — gpt-5.4 — integration', () => {
  runProviderSuite({
    app: makeAoaiApp('azure-gpt54', 'gpt-5-4', 'gpt-5-4'),
    modelAlias: 'gpt-5-4',
    strictFinishReason: true,
  })
})

describe.skipIf(!hasFoundryCredentials)(
  'Azure AI Foundry — Llama-3.3-70B-Instruct — integration',
  () => {
    runProviderSuite({
      app: makeFoundryApp('foundry-llama', 'llama-3-3-70b', 'Llama-3.3-70B-Instruct'),
      modelAlias: 'llama-3-3-70b',
      strictFinishReason: true,
      // Llama-3.3-70B on Foundry serverless has >60s latency for tool-call
      // requests; skip tool tests to avoid flaky timeouts.
      supportsTools: false,
    })
  }
)
