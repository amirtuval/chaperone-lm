import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Request, Response } from 'express'
import { OpenAIPassthroughAdapter } from './passthrough-openai.js'
import type { RouteContext } from './types.js'
import type { ChannelConfig } from '../types.js'

const channel: ChannelConfig = {
  name: 'test-channel',
  type: 'llm-server',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-test',
  protocols: ['openai'],
}

function makeAdapter(baseUrl = 'https://openrouter.ai/api/v1', apiKey?: string) {
  const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  return new OpenAIPassthroughAdapter(baseUrl, authHeaders)
}

function makeCtx(): RouteContext {
  return { channelConfig: channel, upstreamModelId: 'meta/llama-3-70b' }
}

function makeReq(body: object = {}, headers: Record<string, string> = {}): Request {
  return {
    body: { model: 'my-alias', messages: [{ role: 'user', content: 'hi' }], ...body },
    headers,
  } as unknown as Request
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

describe('OpenAIPassthroughAdapter.handleCompletionsRequest', () => {
  it('POSTs to baseUrl/chat/completions with upstream model in body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq(),
      makeRes(),
      makeCtx()
    )

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

    await makeAdapter('https://example.com/api/v1/').handleCompletionsRequest(
      makeReq(),
      makeRes(),
      makeCtx()
    )

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/api/v1/chat/completions')
  })

  it('sends Authorization header from apiKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-abc').handleCompletionsRequest(
      makeReq(),
      makeRes(),
      makeCtx()
    )

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-abc')
  })

  it('omits Authorization header when no apiKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)

    await makeAdapter('https://openrouter.ai/api/v1').handleCompletionsRequest(
      makeReq(),
      makeRes(),
      makeCtx()
    )

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('forwards upstream status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse('{"error":"bad"}', 400)))
    const res = makeRes()

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq(),
      res,
      makeCtx()
    )

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('sets Content-Type from upstream response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse('data: {}\n\n', 200, 'text/event-stream'))
    )
    const res = makeRes()

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq(),
      res,
      makeCtx()
    )

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
  })

  it('rewrites model field in JSON response to alias', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => 'application/json' },
        body: makeReadableStream(['{"id":"1","model":"google/gemini-2.0-flash","choices":[]}']),
      })
    )
    const res = makeRes()

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq(),
      res,
      makeCtx()
    )

    const endArg = (res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(JSON.parse(endArg).model).toBe('my-alias')
  })

  it('rewrites model field in SSE chunks to alias', async () => {
    const chunk =
      'data: {"id":"1","model":"google/gemini-2.0-flash","choices":[{"delta":{"content":"hi"}}]}\n'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/event-stream' : null) },
        body: makeReadableStream([chunk, 'data: [DONE]\n']),
      })
    )
    const res = makeRes()

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq(),
      res,
      makeCtx()
    )

    const written = Buffer.concat(res._written.map((c) => Buffer.from(c))).toString()
    const dataLine = written.split('\n').find((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
    expect(JSON.parse(dataLine!.slice('data: '.length)).model).toBe('my-alias')
  })

  it('passes response body through and calls end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => 'application/json' },
        body: makeReadableStream(['{"id":"1","choices":[]}']),
      })
    )
    const res = makeRes()

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq(),
      res,
      makeCtx()
    )

    expect(res.end).toHaveBeenCalled()
  })

  it('passes stream_options through verbatim to the upstream', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse('{}'))
    vi.stubGlobal('fetch', mockFetch)

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq({ stream: true, stream_options: { include_usage: true } }),
      makeRes(),
      makeCtx()
    )

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.stream_options?.include_usage).toBe(true)
  })

  it('returns 502 and does not throw when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const res = makeRes()

    await makeAdapter('https://openrouter.ai/api/v1', 'sk-test').handleCompletionsRequest(
      makeReq(),
      res,
      makeCtx()
    )

    expect(res.status).toHaveBeenCalledWith(502)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ type: 'server_error' }) })
    )
  })
})
