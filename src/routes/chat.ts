import type { Request, Response } from 'express'
import { streamText, tool, jsonSchema } from 'ai'
import type { ModelMessage, Tool } from 'ai'
import type { AppConfig } from '../types.js'
import type { ProviderAdapter, GatewayRequest } from '../adapters/types.js'
import { resolveRoute } from '../routing/resolver.js'
import { serializeResponse } from '../pipeline/serialize.js'

function isAdapterError(result: unknown): result is { writeError: (res: Response) => void } {
  return typeof result === 'object' && result !== null && 'writeError' in result
}

// Convert OpenAI-format tool definitions to AI SDK tool() objects.
// OpenAI shape: { type: 'function', function: { name, description?, parameters } }
// AI SDK shape: Record<string, Tool>
function buildTools(
  rawTools: GatewayRequest['tools']
): Record<string, Tool> | undefined {
  if (!rawTools || rawTools.length === 0) return undefined
  const result: Record<string, Tool> = {}
  for (const raw of rawTools) {
    if (raw.type !== 'function') continue
    const fn = raw.function
    result[fn.name] = tool({
      description: fn.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: jsonSchema(fn.parameters as any ?? { type: 'object', properties: {} }),
    })
  }
  return Object.keys(result).length > 0 ? result : undefined
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

    const tools = buildTools(transformed.tools)

    try {
      const result = streamText({
        model,
        messages,
        tools,
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
