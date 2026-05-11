import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

const config: AppConfig = {
  channels: [
    {
      name: 'openrouter-test',
      type: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY!,
    },
  ],
  models: {
    'free-model': { channel: 'openrouter-test', model: 'google/gemini-2.0-flash-lite-001' },
  },
}

describe.skipIf(!process.env.OPENROUTER_API_KEY)(
  'OpenRouter adapter (openai-compatible) — integration',
  () => {
    const app = createApp(config, buildAdapterRegistry(config.channels))
    runProviderSuite({ app, modelAlias: 'free-model', strictFinishReason: false })
  }
)
