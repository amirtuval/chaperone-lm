import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

// Anthropic direct API — authenticated via API key.
// Required env vars:
//   ANTHROPIC_API_KEY — Anthropic API key

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const hasCredentials = Boolean(ANTHROPIC_API_KEY)

function makeApp(modelAlias: string, modelId: string) {
  const config: AppConfig = {
    channels: [{ name: 'anthropic-test', type: 'anthropic', apiKey: ANTHROPIC_API_KEY! }],
    models: { [modelAlias]: { channel: 'anthropic-test', model: modelId } },
  }
  return createApp(config, buildAdapterRegistry(config.channels))
}

describe.skipIf(!hasCredentials)('Anthropic — Claude Haiku 4 — integration', () => {
  runProviderSuite({
    app: makeApp('claude-haiku', 'claude-haiku-4-5'),
    modelAlias: 'claude-haiku',
    strictFinishReason: true,
  })
})

describe.skipIf(!hasCredentials)('Anthropic — Claude Sonnet 4.6 — integration', () => {
  runProviderSuite({
    app: makeApp('claude-sonnet', 'claude-sonnet-4-6'),
    modelAlias: 'claude-sonnet',
    strictFinishReason: true,
  })
})
