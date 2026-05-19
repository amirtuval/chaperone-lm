import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runMessagesProviderSuite } from './helpers/messagesProviderSuite.js'

// Vertex AI — via AISdkMessagesAdapter (Gemini) or AnthropicPassthroughAdapter via AI SDK (Anthropic backend).
// Authenticates via Application Default Credentials (ADC).
// Required env vars: VERTEX_PROJECT, VERTEX_REGION (defaults to us-central1)

const PROJECT = process.env.VERTEX_PROJECT
const REGION = process.env.VERTEX_REGION ?? 'us-central1'
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
  return createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
}

describe.skipIf(!hasCredentials)('Vertex Messages API — Gemini 2.5 Flash — integration', () => {
  runMessagesProviderSuite({
    app: makeApp('vertex-gemini', 'gemini', 'gemini-flash', 'gemini-2.5-flash'),
    modelAlias: 'gemini-flash',
    strictFinishReason: true,
  })
})

describe.skipIf(!hasCredentials)(
  'Vertex Messages API — Claude Sonnet 4.6 (Anthropic backend) — integration',
  () => {
    runMessagesProviderSuite({
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
