import { describe, it, expect, vi } from 'vitest'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import { streamText, tool } from 'ai'
import { z } from 'zod'
import { serializeResponse } from './serialize.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeModel(parts: any[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stream: convertArrayToReadableStream(parts as any),
    }),
  })
}

function mockRes() {
  const chunks: string[] = []
  let jsonBody: unknown = null
  let statusCode = 200
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { chunks.push(chunk) }),
    end: vi.fn(),
    json: vi.fn((body: unknown) => { jsonBody = body }),
    status: vi.fn().mockReturnThis(),
    headersSent: false,
    getChunks: () => chunks,
    getJson: () => jsonBody,
    getStatus: () => statusCode,
  }
}

// V3 stream part shapes for mocking
const finishPart = (reason = 'stop') => ({
  type: 'finish',
  finishReason: { unified: reason, provider: reason },
  usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, textTokens: 2, reasoningTokens: 0 } },
})

describe('serializeResponse — streaming', () => {
  it('emits SSE text-delta chunks and [DONE]', async () => {
    const model = makeModel([
      { type: 'text-delta', id: '1', delta: 'Hello' },
      { type: 'text-delta', id: '2', delta: ' world' },
      finishPart(),
    ])
    const result = streamText({ model, messages: [{ role: 'user', content: 'hi' }] })
    const res = mockRes()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await serializeResponse(result as any, 'my-model', true, res as never)

    const chunks = res.getChunks()
    const dataLines = chunks.filter(c => c.startsWith('data: '))
    expect(dataLines.at(-1)).toBe('data: [DONE]\n\n')

    const firstChunk = JSON.parse(dataLines[0].replace('data: ', ''))
    expect(firstChunk.object).toBe('chat.completion.chunk')
    expect(firstChunk.model).toBe('my-model')
    expect(firstChunk.choices[0].delta.content).toBe('Hello')
  })

  it('emits Content-Type text/event-stream header', async () => {
    const model = makeModel([finishPart()])
    const result = streamText({ model, messages: [{ role: 'user', content: 'hi' }] })
    const res = mockRes()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await serializeResponse(result as any, 'my-model', true, res as never)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
  })
})

describe('serializeResponse — non-streaming', () => {
  it('collects text and returns a chat.completion JSON object', async () => {
    const model = makeModel([
      { type: 'text-delta', id: '1', delta: 'Hi' },
      { type: 'text-delta', id: '2', delta: ' there' },
      { type: 'finish', finishReason: { unified: 'stop', provider: 'stop' }, usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, textTokens: 2, reasoningTokens: 0 } } },
    ])
    const result = streamText({ model, messages: [{ role: 'user', content: 'hi' }] })
    const res = mockRes()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await serializeResponse(result as any, 'my-model', false, res as never)

    const body = res.getJson() as Record<string, unknown>
    expect(body.object).toBe('chat.completion')
    expect(body.model).toBe('my-model')
    const choices = body.choices as Array<{ message: { content: string; role: string }; finish_reason: string }>
    expect(choices[0].message.content).toBe('Hi there')
    expect(choices[0].finish_reason).toBe('stop')
  })

  it('includes usage tokens in the response', async () => {
    const model = makeModel([
      { type: 'text-delta', id: '1', delta: 'ok' },
      { type: 'finish', finishReason: { unified: 'stop', provider: 'stop' }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, textTokens: 5, reasoningTokens: 0 } } },
    ])
    const result = streamText({ model, messages: [{ role: 'user', content: 'hi' }] })
    const res = mockRes()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await serializeResponse(result as any, 'my-model', false, res as never)
    const body = res.getJson() as Record<string, unknown>
    const usage = body.usage as Record<string, number>
    expect(usage.prompt_tokens).toBe(10)
    expect(usage.completion_tokens).toBe(5)
    expect(usage.total_tokens).toBe(15)
  })
})

describe('serializeResponse — tool calls', () => {
  it('emits tool-input-start with id/type/name then tool-input-delta with arguments', async () => {
    const model = makeModel([
      { type: 'tool-input-start', id: 'call-1', toolName: 'get_weather' },
      { type: 'tool-input-delta', id: 'call-1', delta: '{"city":' },
      { type: 'tool-input-delta', id: 'call-1', delta: '"London"}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', provider: 'tool_use' }, usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, textTokens: 5, reasoningTokens: 0 } } },
    ])
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'weather?' }],
      tools: {
        get_weather: tool({ inputSchema: z.object({ city: z.string() }) }),
      },
    })
    const res = mockRes()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await serializeResponse(result as any, 'my-model', true, res as never)

    const dataLines = res.getChunks()
      .filter((c: string) => c.startsWith('data: ') && !c.includes('[DONE]'))
      .map((c: string) => JSON.parse(c.replace('data: ', '')))

    const startChunk = dataLines.find((c: Record<string, unknown>) => {
      const choices = c.choices as Array<{ delta: { tool_calls?: Array<{ id?: string }> } }>
      return choices?.[0]?.delta?.tool_calls?.[0]?.id === 'call-1'
    })
    expect(startChunk).toBeDefined()
    const toolCall = (startChunk.choices as Array<{ delta: { tool_calls: Array<Record<string, unknown>> } }>)[0].delta.tool_calls[0]
    expect(toolCall['type']).toBe('function')
    expect((toolCall['function'] as Record<string, unknown>)['name']).toBe('get_weather')

    const deltaChunks = dataLines.filter((c: Record<string, unknown>) => {
      const choices = c.choices as Array<{ delta: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>
      return choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments !== undefined &&
             choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments !== ''
    })
    expect(deltaChunks.length).toBeGreaterThan(0)
  })
})
