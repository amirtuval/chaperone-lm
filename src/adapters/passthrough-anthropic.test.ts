import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { AnthropicPassthroughAdapter } from './passthrough-anthropic.js'
import type { RouteContext } from './types.js'
import type { ChannelConfig } from '../types.js'

const fakeChannel: ChannelConfig = { name: 'ch', type: 'anthropic', apiKey: 'key' }
const ctx: RouteContext = { upstreamModelId: 'claude-sonnet-4-5', channelConfig: fakeChannel }

function makeApp(adapter: AnthropicPassthroughAdapter) {
  const app = express()
  app.use(express.json())
  app.post('/v1/messages', (req, res) => adapter.handleMessagesRequest(req, res, ctx))
  return app
}

function makeTextEncoder() {
  return new TextEncoder()
}

function jsonStream(obj: unknown): ReadableStream<Uint8Array> {
  const enc = makeTextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(JSON.stringify(obj)))
      controller.close()
    },
  })
}

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = makeTextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(enc.encode(line + '\n'))
      }
      controller.close()
    },
  })
}

describe('AnthropicPassthroughAdapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: ReturnType<typeof vi.spyOn<any, any>>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('proxies a JSON response and rewrites model field', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(jsonStream({ type: 'message', model: 'claude-sonnet-4-5', content: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = new AnthropicPassthroughAdapter('https://api.anthropic.com', {
      'x-api-key': 'sk-test',
    })
    const app = makeApp(adapter)

    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'my-alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })

    expect(res.status).toBe(200)
    expect(res.body.model).toBe('my-alias')
  })

  it('forwards the upstream URL with /v1/messages path', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(jsonStream({ type: 'message', model: 'upstream-model', content: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = new AnthropicPassthroughAdapter('https://api.anthropic.com', {})
    const app = makeApp(adapter)

    await request(app)
      .post('/v1/messages')
      .send({
        model: 'my-alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
  })

  it('sends auth headers to upstream', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(jsonStream({ type: 'message', model: 'upstream', content: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = new AnthropicPassthroughAdapter('https://api.anthropic.com', {
      'x-api-key': 'sk-secret',
    })
    const app = makeApp(adapter)

    await request(app)
      .post('/v1/messages')
      .send({
        model: 'alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-secret')
  })

  it('proxies SSE stream and forwards all events', async () => {
    const lines = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[]}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ]
    fetchSpy.mockResolvedValueOnce(
      new Response(sseStream(lines), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const adapter = new AnthropicPassthroughAdapter('https://api.anthropic.com', {})
    const app = makeApp(adapter)

    const res = await request(app)
      .post('/v1/messages')
      .set('Accept', 'text/event-stream')
      .send({
        model: 'my-alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      })

    expect(res.status).toBe(200)
    expect(res.text).toContain('message_start')
    expect(res.text).toContain('message_stop')
  })

  it('rewrites top-level model field in SSE data lines', async () => {
    // Some SSE lines (e.g. error events) carry a top-level model field
    const lines = [
      'data: {"type":"error","model":"claude-sonnet-4-5","error":{"type":"api_error","message":"oops"}}',
      '',
    ]
    fetchSpy.mockResolvedValueOnce(
      new Response(sseStream(lines), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const adapter = new AnthropicPassthroughAdapter('https://api.anthropic.com', {})
    const app = makeApp(adapter)

    const res = await request(app)
      .post('/v1/messages')
      .set('Accept', 'text/event-stream')
      .send({
        model: 'my-alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      })

    expect(res.status).toBe(200)
    expect(res.text).toContain('"my-alias"')
  })

  it('returns 502 when upstream connection fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const adapter = new AnthropicPassthroughAdapter('https://nowhere.example.com', {})
    const app = makeApp(adapter)

    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })

    expect(res.status).toBe(502)
    expect(res.body.type).toBe('error')
    expect(res.body.error.type).toBe('api_error')
  })

  it('strips trailing slash from baseUrl', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(jsonStream({ type: 'message', model: 'x', content: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = new AnthropicPassthroughAdapter('https://api.anthropic.com/', {})
    const app = makeApp(adapter)

    await request(app)
      .post('/v1/messages')
      .send({
        model: 'alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
  })
})
