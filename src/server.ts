import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { AppConfig } from './types.js'
import type { CompletionsProviderAdapter, MessagesProviderAdapter } from './adapters/types.js'
import { makeChatHandler } from './routes/chat.js'
import { makeModelsHandler } from './routes/models.js'
import { registerMessagesRoute } from './routes/messages.js'
import { logger } from './logger.js'

export function createApp(
  config: AppConfig,
  completionsRegistry: Map<string, CompletionsProviderAdapter>,
  messagesRegistry: Map<string, MessagesProviderAdapter>
) {
  const app = express()

  app.use(express.json())

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    const model = (req.body as { model?: string } | undefined)?.model ?? ''
    res.on('finish', () => {
      const ms = Date.now() - start
      const status = res.statusCode
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
      logger[level]({ method: req.method, path: req.path, model, status, ms }, 'request')
    })
    next()
  })

  app.post('/v1/chat/completions', makeChatHandler(config, completionsRegistry))
  app.get('/v1/models', makeModelsHandler(config, completionsRegistry))
  registerMessagesRoute(app, config, messagesRegistry)

  return app
}
