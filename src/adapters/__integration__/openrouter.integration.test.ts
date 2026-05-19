import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

const config: AppConfig = {
  channels: [
    {
      name: 'openrouter-test',
      type: 'llm-server',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY!,
      protocols: ['openai'],
    },
  ],
  models: {
    'free-model': { channel: 'openrouter-test', model: 'google/gemini-2.0-flash-lite-001' },
  },
}

describe.skipIf(!process.env.OPENROUTER_API_KEY)(
  'OpenRouter adapter (llm-server) — integration',
  () => {
    const app = createApp(config, buildCompletionsRegistry(config))
    runProviderSuite({ app, modelAlias: 'free-model', strictFinishReason: false })
  }
)
