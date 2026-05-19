import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runMessagesProviderSuite } from './helpers/messagesProviderSuite.js'

// Anthropic direct API — passthrough via AnthropicPassthroughAdapter.
// Required env vars:
//   ANTHROPIC_API_KEY — Anthropic API key

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const hasCredentials = Boolean(ANTHROPIC_API_KEY)

function makeApp(modelAlias: string, modelId: string) {
  const config: AppConfig = {
    channels: [{ name: 'anthropic-test', type: 'anthropic', apiKey: ANTHROPIC_API_KEY! }],
    models: { [modelAlias]: { channel: 'anthropic-test', model: modelId } },
  }
  return createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
}

describe.skipIf(!hasCredentials)('Anthropic Messages API — Claude Haiku 4 — integration', () => {
  runMessagesProviderSuite({
    app: makeApp('claude-haiku', 'claude-haiku-4-5'),
    modelAlias: 'claude-haiku',
    strictFinishReason: true,
  })
})

describe.skipIf(!hasCredentials)('Anthropic Messages API — Claude Sonnet 4.6 — integration', () => {
  runMessagesProviderSuite({
    app: makeApp('claude-sonnet', 'claude-sonnet-4-6'),
    modelAlias: 'claude-sonnet',
    strictFinishReason: true,
  })
})
