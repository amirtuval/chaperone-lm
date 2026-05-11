import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

// All Vertex backends authenticate via Application Default Credentials (ADC).
// Run: gcloud auth application-default login
// Required env vars: VERTEX_PROJECT, VERTEX_REGION (defaults to us-central1)

const PROJECT = process.env.VERTEX_PROJECT
const REGION = process.env.VERTEX_REGION ?? 'us-central1'
// Anthropic models on Vertex are only servable in us-east5
const ANTHROPIC_REGION = process.env.VERTEX_ANTHROPIC_REGION ?? 'us-east5'
const hasCredentials = Boolean(PROJECT)

function makeApp(
  channelName: string,
  provider: 'gemini' | 'anthropic' | 'maas',
  modelAlias: string,
  modelId: string,
  region = REGION
) {
  const config: AppConfig = {
    channels: [{ name: channelName, type: 'vertex', project: PROJECT!, region, provider }],
    models: { [modelAlias]: { channel: channelName, model: modelId } },
  }
  return createApp(config, buildAdapterRegistry(config.channels))
}

describe.skipIf(!hasCredentials)('Vertex — Gemini 2.5 Flash — integration', () => {
  runProviderSuite({
    app: makeApp('vertex-gemini', 'gemini', 'gemini-flash', 'gemini-2.5-flash'),
    modelAlias: 'gemini-flash',
    strictFinishReason: true,
  })
})

describe.skipIf(!hasCredentials)(
  'Vertex — Claude Sonnet 4.6 (Anthropic backend) — integration',
  () => {
    runProviderSuite({
      app: makeApp(
        'vertex-anthropic',
        'anthropic',
        'claude-sonnet',
        'claude-sonnet-4-6',
        ANTHROPIC_REGION
      ),
      modelAlias: 'claude-sonnet',
      strictFinishReason: true,
    })
  }
)

describe.skipIf(!hasCredentials)('Vertex — DeepSeek V3.2 (MaaS backend) — integration', () => {
  runProviderSuite({
    app: makeApp('vertex-maas', 'maas', 'deepseek-v3', 'deepseek-ai/deepseek-v3.2-maas@001'),
    modelAlias: 'deepseek-v3',
    strictFinishReason: false,
  })
})
