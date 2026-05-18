import type { Request, Response } from 'express'
import type { AppConfig } from '../types.js'
import type { ProviderAdapter, GatewayRequest } from '../adapters/types.js'
import { resolveRoute } from '../routing/resolver.js'

export function makeChatHandler(config: AppConfig, adapterRegistry: Map<string, ProviderAdapter>) {
  return async (req: Request, res: Response) => {
    const body = req.body as GatewayRequest
    const alias = typeof body.model === 'string' ? body.model : ''

    const route = resolveRoute(alias, config, adapterRegistry)
    if (!route) {
      res.status(404).json({
        error: {
          message: `Model '${alias}' not found. Check /v1/models for available models.`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      })
      return
    }

    await route.adapter.handleRequest(req, res, {
      channelConfig: route.channelConfig,
      upstreamModelId: route.upstreamModelId,
      deploymentId: route.deploymentId,
    })
  }
}
