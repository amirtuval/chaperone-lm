import express from 'express'
import type { AppConfig } from './types.js'
import type { ProviderAdapter } from './adapters/types.js'
import { makeChatHandler } from './routes/chat.js'
import { makeModelsHandler } from './routes/models.js'

export function createApp(config: AppConfig, adapterRegistry: Map<string, ProviderAdapter>) {
  const app = express()

  app.use(express.json())

  app.post('/v1/chat/completions', makeChatHandler(config, adapterRegistry))
  app.get('/v1/models', makeModelsHandler(config, adapterRegistry))

  return app
}
