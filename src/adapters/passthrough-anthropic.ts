import type { Request, Response } from 'express'
import type { MessagesProviderAdapter, RouteContext } from './types.js'
import type { AnthropicMessagesRequest } from '../pipeline/anthropic-parse.js'
import { logger } from '../logger.js'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function rewriteModel(json: Record<string, unknown>, alias: string): Record<string, unknown> {
  if ('model' in json) return { ...json, model: alias }
  // message_start carries the model nested under `message`
  if (json['type'] === 'message_start' && json['message'] && typeof json['message'] === 'object') {
    const msg = json['message'] as Record<string, unknown>
    if ('model' in msg) return { ...json, message: { ...msg, model: alias } }
  }
  return json
}

function rewriteSSELine(line: string, alias: string): string {
  if (!line.startsWith('data: ')) return line
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

export class AnthropicPassthroughAdapter implements MessagesProviderAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>
  ) {}

  async handleMessagesRequest(req: Request, res: Response, ctx: RouteContext): Promise<void> {
    const body = req.body as AnthropicMessagesRequest
    const alias = typeof body.model === 'string' ? body.model : ''
    const baseUrl = this.baseUrl.replace(/\/$/, '')

    const upstreamBody: AnthropicMessagesRequest = { ...body, model: ctx.upstreamModelId }
    const upstreamUrl = `${baseUrl}/v1/messages`

    logger.debug(
      { url: upstreamUrl, model: ctx.upstreamModelId, stream: upstreamBody.stream ?? false },
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
          // Forward all anthropic-* headers from the client (version, beta flags, etc.)
          ...Object.fromEntries(
            Object.entries(req.headers)
              .filter(([k]) => k.startsWith('anthropic-'))
              .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')])
          ),
          // Ensure anthropic-version always has a value
          'anthropic-version':
            (req.headers['anthropic-version'] as string | undefined) ?? '2023-06-01',
        },
        body: JSON.stringify(upstreamBody),
      })
    } catch (err) {
      logger.error(
        { err, url: upstreamUrl, model: ctx.upstreamModelId },
        'upstream connection error'
      )
      res.status(502).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : 'Upstream connection error',
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
