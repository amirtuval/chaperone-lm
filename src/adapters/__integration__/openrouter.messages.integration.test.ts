import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runMessagesProviderSuite } from './helpers/messagesProviderSuite.js'

// OpenRouter via llm-server (openai protocol) — via AISdkMessagesAdapter with openai-compatible SDK.
// Required env vars:
//   OPENROUTER_API_KEY — OpenRouter API key

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
  'OpenRouter Messages API (llm-server) — integration',
  () => {
    const app = createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
    runMessagesProviderSuite({
      app,
      modelAlias: 'free-model',
      strictFinishReason: false,
    })
  }
)
