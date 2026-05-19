import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runMessagesProviderSuite } from './helpers/messagesProviderSuite.js'

// Google Generative AI — via AISdkMessagesAdapter.
// Required env vars:
//   GOOGLE_GENERATIVE_AI_API_KEY — Google AI Studio API key

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
const hasCredentials = Boolean(GOOGLE_API_KEY)

function makeApp(modelAlias: string, modelId: string) {
  const config: AppConfig = {
    channels: [{ name: 'google-test', type: 'google', apiKey: GOOGLE_API_KEY! }],
    models: { [modelAlias]: { channel: 'google-test', model: modelId } },
  }
  return createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
}

describe.skipIf(!hasCredentials)('Google Messages API — Gemini 2.0 Flash Lite — integration', () => {
  runMessagesProviderSuite({
    app: makeApp('gemini-flash-lite', 'gemini-2.0-flash-lite'),
    modelAlias: 'gemini-flash-lite',
    strictFinishReason: true,
  })
})
