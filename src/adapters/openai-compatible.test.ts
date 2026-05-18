import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Request, Response } from 'express'
import { OpenAICompatibleAdapter } from './openai-compatible.js'
import type { RouteContext } from './types.js'
import type { ChannelConfig } from '../types.js'

const adapter = new OpenAICompatibleAdapter()

function makeChannelConfig(overrides: Partial<Extract<ChannelConfig, { type: 'openai-compatible' }>> = {}): ChannelConfig {
  return {
    name: 'test-channel',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-test',
    ...overrides,
  }
}

function makeCtx(channelConfig: ChannelConfig = makeChannelConfig()): RouteContext {
  return { channelConfig, upstreamModelId: 'meta/llama-3-70b' }
}

function makeReq(body: object = {}, headers: Record<string, string> = {}): Request {
  return { body: { model: 'my-alias', messages: [{ role: 'user', content: 'hi' }], ...body }, headers } as unknown as Request
}

function makeRes() {
  const written: Uint8Array[] = []
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    write: vi.fn((chunk: Uint8Array) => written.push(chunk)),
    end: vi.fn(),
    json: vi.fn(),
    headersSent: false,
    _written: written,
  }
  return res as unknown as Response & { _written: Uint8Array[] }
}

function makeReadableStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk))
      }
      controller.close()
    },
  })
}

function makeFetchResponse(body: string, status = 200, contentType = 'application/json') {
  return {
    status,
    headers: { get: (h: string) => (h === 'content-type' ? contentType : null) },
    body: makeReadableStream([body]),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAICompatibleAdapter.getBaseUrl', () => {
  it('returns the configured baseUrl', () => {
    expect(adapter.getBaseUrl(makeChannelConfig())).toBe('https://openrouter.ai/api/v1')
  })

  it('throws if channel type is not openai-compatible', () => {
    const wrong: ChannelConfig = { name: 'x', type: 'openai', apiKey: 'k' }
    expect(() => adapter.getBaseUrl(wrong)).toThrow("requires channel type 'openai-compatible'")
  })
})

describe('OpenAICompatibleAdapter.getAuthHeaders', () => {
  it('returns Authorization header when apiKey is set', () => {
    const headers = adapter.getAuthHeaders(makeChannelConfig({ apiKey: 'sk-abc' }))
    expect(headers).toEqual({ Authorization: 'Bearer sk-abc' })
  })

  it('returns empty headers when apiKey is absent', () => {
    const headers = adapter.getAuthHeaders(makeChannelConfig({ apiKey: undefined }))
    expect(headers).toEqual({})
  })
})

describe('OpenAICompatibleAdapter.handleRequest', () => {
  it('POSTs to baseUrl/chat/completions with upstream model in body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)

    await adapter.handleRequest(makeReq(), makeRes(), makeCtx())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.model).toBe('meta/llama-3-70b')
  })

  it('strips trailing slash from baseUrl before appending path', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)
    const ctx = makeCtx(makeChannelConfig({ baseUrl: 'https://example.com/api/v1/' }))

    await adapter.handleRequest(makeReq(), makeRes(), ctx)

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/api/v1/chat/completions')
  })

  it('sends Authorization header from apiKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)

    await adapter.handleRequest(makeReq(), makeRes(), makeCtx())

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test')
  })

  it('omits Authorization header when no apiKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)
    const ctx = makeCtx(makeChannelConfig({ apiKey: undefined }))

    await adapter.handleRequest(makeReq(), makeRes(), ctx)

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('forwards upstream status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse('{"error":"bad"}', 400)))
    const res = makeRes()

    await adapter.handleRequest(makeReq(), res, makeCtx())

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('sets Content-Type from upstream response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse('data: {}\n\n', 200, 'text/event-stream')))
    const res = makeRes()

    await adapter.handleRequest(makeReq(), res, makeCtx())

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
  })

  it('pipes response body chunks and calls end', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => 'application/json' },
      body: makeReadableStream(['{"id":', '"abc"}'])
    }))
    const res = makeRes()

    await adapter.handleRequest(makeReq(), res, makeCtx())

    const body = Buffer.concat(res._written.map((c) => Buffer.from(c))).toString()
    expect(body).toBe('{"id":"abc"}')
    expect(res.end).toHaveBeenCalled()
  })

  it('returns 502 and does not throw when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const res = makeRes()

    await adapter.handleRequest(makeReq(), res, makeCtx())

    expect(res.status).toHaveBeenCalledWith(502)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ type: 'server_error' }) })
    )
  })
})
