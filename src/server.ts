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

  app.use(express.json({ limit: '50mb' }))

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

  app.all('/', (_req: Request, res: Response) => res.sendStatus(200))

  app.post('/v1/chat/completions', makeChatHandler(config, completionsRegistry))
  app.get('/v1/models', makeModelsHandler(config, completionsRegistry))
  registerMessagesRoute(app, config, messagesRegistry)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(
    (
      err: Error & { status?: number; type?: string },
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const status = err.status ?? 500
      logger.error({ err, status }, 'unhandled error')
      res.status(status).json({
        type: 'error',
        error: { type: 'api_error', message: err.message },
      })
    }
  )

  return app
}
