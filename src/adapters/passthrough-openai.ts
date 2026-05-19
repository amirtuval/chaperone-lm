import type { Request, Response } from 'express'
import type { CompletionsProviderAdapter, RouteContext, GatewayRequest } from './types.js'
import { logger } from '../logger.js'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function rewriteModel(json: Record<string, unknown>, alias: string): Record<string, unknown> {
  if ('model' in json) return { ...json, model: alias }
  return json
}

function rewriteSSELine(line: string, alias: string): string {
  if (!line.startsWith('data: ') || line === 'data: [DONE]') return line
  try {
    const json = JSON.parse(line.slice('data: '.length)) as Record<string, unknown>
    return 'data: ' + JSON.stringify(rewriteModel(json, alias))
  } catch {
    return line
  }
}

async function pipeSSE(
  body: ReadableStream<Uint8Array>,
  res: Response,
  alias: string
): Promise<void> {
  const reader = body.getReader()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        res.write(encoder.encode(rewriteSSELine(line, alias) + '\n'))
      }
    }
    if (buffer) res.write(encoder.encode(rewriteSSELine(buffer, alias) + '\n'))
  } finally {
    res.end()
  }
}

async function pipeJSON(
  body: ReadableStream<Uint8Array>,
  res: Response,
  alias: string
): Promise<void> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } catch {
    res.end()
    return
  }
  const text = decoder.decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    res.end(JSON.stringify(rewriteModel(json, alias)))
  } catch {
    res.end(text)
  }
}

export class OpenAIPassthroughAdapter implements CompletionsProviderAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>
  ) {}

  async handleCompletionsRequest(req: Request, res: Response, ctx: RouteContext): Promise<void> {
    const alias =
      typeof (req.body as GatewayRequest).model === 'string'
        ? ((req.body as GatewayRequest).model as string)
        : ''
    const baseUrl = this.baseUrl.replace(/\/$/, '')

    const body: GatewayRequest = { ...(req.body as GatewayRequest), model: ctx.upstreamModelId }

    const upstreamUrl = `${baseUrl}/chat/completions`
    logger.debug(
      { url: upstreamUrl, model: ctx.upstreamModelId, stream: body.stream ?? false },
      'upstream request'
    )

    let upstream: globalThis.Response
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: (req.headers['accept'] as string | undefined) ?? 'application/json',
          ...this.authHeaders,
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      logger.error(
        { err, url: upstreamUrl, model: ctx.upstreamModelId },
        'upstream connection error'
      )
      res.status(502).json({
        error: {
          message: err instanceof Error ? err.message : 'Upstream connection error',
          type: 'server_error',
        },
      })
      return
    }

    const ct = upstream.headers.get('content-type') ?? ''
    const upstreamLevel =
      upstream.status >= 500 ? 'error' : upstream.status >= 400 ? 'warn' : 'debug'
    logger[upstreamLevel](
      { status: upstream.status, contentType: ct, model: ctx.upstreamModelId },
      'upstream response'
    )

    res.status(upstream.status)
    if (ct) res.setHeader('Content-Type', ct)

    if (!upstream.body) {
      res.end()
      return
    }

    if (ct.includes('text/event-stream')) {
      await pipeSSE(upstream.body, res, alias)
    } else {
      await pipeJSON(upstream.body, res, alias)
    }
  }
}
