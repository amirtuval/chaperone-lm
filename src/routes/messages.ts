import type { Request, Response, Router } from 'express'
import type { AppConfig } from '../types.js'
import type { MessagesProviderAdapter } from '../adapters/types.js'
import { logger } from '../logger.js'

export function registerMessagesRoute(
  router: Router,
  config: AppConfig,
  messagesRegistry: Map<string, MessagesProviderAdapter>
): void {
  router.post('/v1/messages', async (req: Request, res: Response) => {
    const body = req.body as { model?: unknown }
    const alias = typeof body.model === 'string' ? body.model : ''

    if (!alias) {
      res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Missing model field' },
      })
      return
    }

    // Accept both the raw alias and the claude-prefixed form emitted by /v1/models for Anthropic clients
    const resolvedAlias = messagesRegistry.has(alias)
      ? alias
      : alias.startsWith('claude-') && messagesRegistry.has(alias.slice('claude-'.length))
        ? alias.slice('claude-'.length)
        : null

    if (!resolvedAlias) {
      res.status(404).json({
        type: 'error',
        error: { type: 'not_found_error', message: `Model not found: ${alias}` },
      })
      return
    }

    const adapter = messagesRegistry.get(resolvedAlias)!
    const modelConfig = config.models[resolvedAlias]
    const channelConfig = config.channels.find((ch) => ch.name === modelConfig.channel)
    if (!channelConfig) {
      res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: 'Channel configuration not found' },
      })
      return
    }

    logger.debug({ alias, upstreamModel: modelConfig.model }, 'messages request')

    await adapter.handleMessagesRequest(req, res, {
      upstreamModelId: modelConfig.model,
      channelConfig,
    })
  })
}
