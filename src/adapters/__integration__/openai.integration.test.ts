import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

// OpenAI direct API — authenticated via API key.
// Required env vars:
//   OPENAI_API_KEY — OpenAI API key

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const hasCredentials = Boolean(OPENAI_API_KEY)

function makeApp(modelAlias: string, modelId: string) {
  const config: AppConfig = {
    channels: [{ name: 'openai-test', type: 'openai', apiKey: OPENAI_API_KEY! }],
    models: { [modelAlias]: { channel: 'openai-test', model: modelId } },
  }
  return createApp(config, buildAdapterRegistry(config.channels))
}

describe.skipIf(!hasCredentials)('OpenAI — gpt-4o-mini — integration', () => {
  runProviderSuite({
    app: makeApp('gpt-4o-mini', 'gpt-4o-mini'),
    modelAlias: 'gpt-4o-mini',
    strictFinishReason: true,
  })
})

describe.skipIf(!hasCredentials)('OpenAI — o4-mini (reasoning) — integration', () => {
  runProviderSuite({
    app: makeApp('o4-mini', 'o4-mini'),
    modelAlias: 'o4-mini',
    strictFinishReason: true,
  })
})
