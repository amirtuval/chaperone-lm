import type { Request, Response } from 'express'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { MessagesProviderAdapter, RouteContext, AdapterRequestError } from './types.js'
import type { AnthropicMessagesRequest } from '../pipeline/anthropic-parse.js'
import { parseAnthropicRequest } from '../pipeline/anthropic-parse.js'
import {
  serializeAnthropicStream,
  serializeAnthropicGenerate,
} from '../pipeline/anthropic-serialize.js'
import { logger } from '../logger.js'

function isAdapterError(result: unknown): result is AdapterRequestError {
  return typeof result === 'object' && result !== null && 'writeError' in result
}

export class AISdkMessagesAdapter implements MessagesProviderAdapter {
  constructor(
    private readonly model: LanguageModelV3,
    private readonly transformFn?: (
      req: AnthropicMessagesRequest
    ) => AnthropicMessagesRequest | AdapterRequestError
  ) {}

  async handleMessagesRequest(req: Request, res: Response, ctx: RouteContext): Promise<void> {
    const body = req.body as AnthropicMessagesRequest
    const alias = typeof body.model === 'string' ? body.model : ''

    const withUpstream: AnthropicMessagesRequest = { ...body, model: ctx.upstreamModelId }
    const transformed = this.transformFn ? this.transformFn(withUpstream) : withUpstream

    if (isAdapterError(transformed)) {
      transformed.writeError(res)
      return
    }

    const options = parseAnthropicRequest(transformed)

    try {
      if (transformed.stream === true) {
        const { stream } = await this.model.doStream(options)
        await serializeAnthropicStream(stream, alias, res)
      } else {
        const result = await this.model.doGenerate(options)
        serializeAnthropicGenerate(result, alias, res)
      }
    } catch (err) {
      logger.error(
        { err, model: ctx.upstreamModelId, channel: ctx.channelConfig.name },
        'upstream error'
      )
      if (!res.headersSent) {
        res.status(502).json({
          type: 'error',
          error: {
            type: 'api_error',
            message: err instanceof Error ? err.message : 'Upstream error',
          },
        })
      }
    }
  }
}
