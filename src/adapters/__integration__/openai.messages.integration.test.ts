import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runMessagesProviderSuite } from './helpers/messagesProviderSuite.js'

// OpenAI — via AISdkMessagesAdapter (translates Anthropic → AI SDK → Anthropic format).
// Required env vars:
//   OPENAI_API_KEY — OpenAI API key

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const hasCredentials = Boolean(OPENAI_API_KEY)

function makeApp(modelAlias: string, modelId: string) {
  const config: AppConfig = {
    channels: [{ name: 'openai-test', type: 'openai', apiKey: OPENAI_API_KEY! }],
    models: { [modelAlias]: { channel: 'openai-test', model: modelId } },
  }
  return createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
}

describe.skipIf(!hasCredentials)('OpenAI Messages API — gpt-4o-mini — integration', () => {
  runMessagesProviderSuite({
    app: makeApp('gpt-4o-mini', 'gpt-4o-mini'),
    modelAlias: 'gpt-4o-mini',
    strictFinishReason: true,
  })
})
