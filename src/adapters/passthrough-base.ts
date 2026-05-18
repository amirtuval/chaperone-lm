import type { Request, Response } from 'express'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, RouteContext, GatewayRequest } from './types.js'

export abstract class PassthroughAdapter implements ProviderAdapter {
  abstract getBaseUrl(channelConfig: ChannelConfig): string
  abstract getAuthHeaders(channelConfig: ChannelConfig): Record<string, string>

  async handleRequest(req: Request, res: Response, ctx: RouteContext): Promise<void> {
    const baseUrl = this.getBaseUrl(ctx.channelConfig).replace(/\/$/, '')
    const authHeaders = this.getAuthHeaders(ctx.channelConfig)

    const body: GatewayRequest = { ...(req.body as GatewayRequest), model: ctx.upstreamModelId }

    let upstream: globalThis.Response
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: (req.headers['accept'] as string | undefined) ?? 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      res.status(502).json({
        error: {
          message: err instanceof Error ? err.message : 'Upstream connection error',
          type: 'server_error',
        },
      })
      return
    }

    res.status(upstream.status)
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)

    if (upstream.body) {
      const reader = upstream.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      } finally {
        res.end()
      }
    } else {
      res.end()
    }
  }
}
