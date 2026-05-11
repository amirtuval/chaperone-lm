import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

const config: AppConfig = {
  channels: [{ name: 'google-test', type: 'google', apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! }],
  models: { 'gemini-flash': { channel: 'google-test', model: 'gemini-2.5-flash' } },
}

describe.skipIf(!process.env.GOOGLE_GENERATIVE_AI_API_KEY)('Google adapter — integration', () => {
  const app = createApp(config, buildAdapterRegistry(config.channels))
  runProviderSuite({ app, modelAlias: 'gemini-flash', strictFinishReason: true })
})
