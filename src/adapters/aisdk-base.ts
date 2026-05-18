import type { Request, Response } from 'express'
import { streamText, tool, jsonSchema } from 'ai'
import type { ModelMessage, Tool } from 'ai'
import type { LanguageModel } from 'ai'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import { serializeResponse } from '../pipeline/serialize.js'
import type { ProviderAdapter, RouteContext, GatewayRequest, AdapterRequestError } from './types.js'

function isAdapterError(result: unknown): result is AdapterRequestError {
  return typeof result === 'object' && result !== null && 'writeError' in result
}

function buildTools(rawTools: GatewayRequest['tools']): Record<string, Tool> | undefined {
  if (!rawTools || rawTools.length === 0) return undefined
  const result: Record<string, Tool> = {}
  for (const raw of rawTools) {
    if (raw.type !== 'function') continue
    const fn = raw.function
    result[fn.name] = tool({
      description: fn.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: jsonSchema((fn.parameters as any) ?? { type: 'object', properties: {} }),
    })
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export abstract class AISdkAdapter implements ProviderAdapter {
  abstract transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError

  abstract createModel(
    channelConfig: ChannelConfig,
    modelId: string,
    deploymentId?: string
  ): LanguageModel

  transformResponse(
    stream: AsyncIterable<LanguageModelV3StreamPart>
  ): AsyncIterable<LanguageModelV3StreamPart> {
    return stream
  }

  async handleRequest(req: Request, res: Response, ctx: RouteContext): Promise<void> {
    const body = req.body as GatewayRequest
    const alias = typeof body.model === 'string' ? body.model : ''

    const requestWithUpstreamModel: GatewayRequest = { ...body, model: ctx.upstreamModelId }

    const transformed = this.transformRequest(requestWithUpstreamModel)
    if (isAdapterError(transformed)) {
      transformed.writeError(res)
      return
    }

    const model = this.createModel(ctx.channelConfig, ctx.upstreamModelId, ctx.deploymentId)
    const messages = (transformed.messages ?? []) as ModelMessage[]
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

      await serializeResponse(result, alias, transformed.stream === true, res)
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
