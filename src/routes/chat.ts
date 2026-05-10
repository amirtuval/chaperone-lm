import type { Request, Response } from 'express'
import { streamText } from 'ai'
import type { ModelMessage } from 'ai'
import type { AppConfig } from '../types.js'
import type { ProviderAdapter, GatewayRequest } from '../adapters/types.js'
import { resolveRoute } from '../routing/resolver.js'
import { serializeResponse } from '../pipeline/serialize.js'

function isAdapterError(result: unknown): result is { writeError: (res: Response) => void } {
  return typeof result === 'object' && result !== null && 'writeError' in result
}

export function makeChatHandler(config: AppConfig, adapterRegistry: Map<string, ProviderAdapter>) {
  return async (req: Request, res: Response) => {
    const body = req.body as GatewayRequest

    // 1. Route resolution
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

    // Replace alias with upstream model ID
    const requestWithUpstreamModel: GatewayRequest = {
      ...body,
      model: route.upstreamModelId,
    }

    // 2. Adapter request transform
    const transformed = route.adapter.transformRequest(requestWithUpstreamModel)
    if (isAdapterError(transformed)) {
      transformed.writeError(res)
      return
    }

    // 3. Create model + call streamText
    const model = route.adapter.createModel(
      route.channelConfig,
      route.upstreamModelId,
      route.deploymentId
    )

    const messages = (transformed.messages ?? []) as ModelMessage[]

    // providerOptions from adapter are passed through as-is
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerOptions = transformed.providerOptions as any

    try {
      const result = streamText({
        model,
        messages,
        temperature: transformed.temperature ?? undefined,
        maxOutputTokens: transformed.max_tokens ?? undefined,
        topP: transformed.top_p ?? undefined,
        providerOptions,
      })

      const isStreaming = transformed.stream === true

      // 4 & 5. Serialize (transformResponse is a passthrough in v1 — stream goes directly to serializer)
      await serializeResponse(result, alias, isStreaming, res)
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({
          error: {
            message: err instanceof Error ? err.message : 'Upstream error',
            type: 'server_error',
          },
        })
      }
    }
  }
}
