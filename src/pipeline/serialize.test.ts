import { describe, it, expect, vi } from 'vitest'
import { convertArrayToReadableStream } from 'ai/test'
import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { serializeStream, serializeGenerate } from './serialize.js'

function makeStream(parts: LanguageModelV3StreamPart[]) {
  return convertArrayToReadableStream(parts) as ReadableStream<LanguageModelV3StreamPart>
}

function makeGenerateResult(
  overrides: Partial<LanguageModelV3GenerateResult> = {}
): LanguageModelV3GenerateResult {
  return {
    content: [],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 2, text: 2, reasoning: 0 },
    },
    warnings: [],
    ...overrides,
  }
}

function mockRes() {
  const chunks: string[] = []
  let jsonBody: unknown = null
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => chunks.push(chunk)),
    end: vi.fn(),
    json: vi.fn((body: unknown) => {
      jsonBody = body
    }),
    status: vi.fn().mockReturnThis(),
    headersSent: false,
    getChunks: () => chunks,
    getJson: () => jsonBody,
  }
}

describe('serializeStream', () => {
  it('emits role chunk first, then text-delta chunks, then [DONE]', async () => {
    const res = mockRes()
    await serializeStream(
      makeStream([
        { type: 'text-delta', id: '1', delta: 'Hello' },
        { type: 'text-delta', id: '2', delta: ' world' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 2, text: 2, reasoning: 0 },
          },
        },
      ]),
      'my-model',
      res as never
    )

    const dataLines = res.getChunks().filter((c) => c.startsWith('data: '))
    expect(dataLines.at(-1)).toBe('data: [DONE]\n\n')

    const roleChunk = JSON.parse(dataLines[0].replace('data: ', ''))
    expect(roleChunk.object).toBe('chat.completion.chunk')
    expect(roleChunk.model).toBe('my-model')
    expect(roleChunk.choices[0].delta).toEqual({ role: 'assistant', content: '' })
    expect(roleChunk.choices[0].finish_reason).toBeNull()

    const firstTextChunk = JSON.parse(dataLines[1].replace('data: ', ''))
    expect(firstTextChunk.choices[0].delta.content).toBe('Hello')
  })

  it('emits a correct full SSE sequence: role → text → finish → [DONE]', async () => {
    const res = mockRes()
    await serializeStream(
      makeStream([
        { type: 'text-delta', id: '1', delta: 'Hi' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ]),
      'my-model',
      res as never
    )

    const dataLines = res.getChunks().filter((c) => c.startsWith('data: '))
    const parsed = dataLines
      .filter((l) => !l.includes('[DONE]'))
      .map((l) => JSON.parse(l.replace('data: ', '')))

    for (const c of parsed) {
      expect(c.object).toBe('chat.completion.chunk')
      expect(c.model).toBe('my-model')
      expect(typeof c.id).toBe('string')
      expect(typeof c.created).toBe('number')
    }

    expect(parsed[0].choices[0].delta).toEqual({ role: 'assistant', content: '' })

    const textChunks = parsed.filter(
      (c) => typeof c.choices[0].delta.content === 'string' && c.choices[0].delta.content.length > 0
    )
    expect(textChunks.length).toBeGreaterThan(0)

    const finishChunk = parsed.at(-1)
    expect(finishChunk.choices[0].delta).toEqual({})
    expect(finishChunk.choices[0].finish_reason).toBe('stop')

    expect(dataLines.at(-1)).toBe('data: [DONE]\n\n')
  })

  it('emits Content-Type text/event-stream header', async () => {
    const res = mockRes()
    await serializeStream(
      makeStream([
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
        },
      ]),
      'my-model',
      res as never
    )
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
  })

  it('emits tool-input-start with id/type/name then tool-input-delta with arguments', async () => {
    const res = mockRes()
    await serializeStream(
      makeStream([
        { type: 'tool-input-start', id: 'call-1', toolName: 'get_weather' },
        { type: 'tool-input-delta', id: 'call-1', delta: '{"city":' },
        { type: 'tool-input-delta', id: 'call-1', delta: '"London"}' },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
        },
      ]),
      'my-model',
      res as never
    )

    const dataLines = res
      .getChunks()
      .filter((c) => c.startsWith('data: ') && !c.includes('[DONE]'))
      .map((c) => JSON.parse(c.replace('data: ', '')))

    const startChunk = dataLines.find(
      (c: Record<string, unknown>) =>
        (c.choices as Array<{ delta: { tool_calls?: Array<{ id?: string }> } }>)?.[0]?.delta
          ?.tool_calls?.[0]?.id === 'call-1'
    )
    expect(startChunk).toBeDefined()
    const toolCall = (
      startChunk.choices as Array<{ delta: { tool_calls: Array<Record<string, unknown>> } }>
    )[0].delta.tool_calls[0]
    expect(toolCall['type']).toBe('function')
    expect((toolCall['function'] as Record<string, unknown>)['name']).toBe('get_weather')

    const deltaChunks = dataLines.filter(
      (c: Record<string, unknown>) =>
        (
          c.choices as Array<{
            delta: { tool_calls?: Array<{ function?: { arguments?: string } }> }
          }>
        )?.[0]?.delta?.tool_calls?.[0]?.function?.arguments !== undefined &&
        (
          c.choices as Array<{
            delta: { tool_calls?: Array<{ function?: { arguments?: string } }> }
          }>
        )[0].delta.tool_calls![0].function!.arguments !== ''
    )
    expect(deltaChunks.length).toBeGreaterThan(0)
  })
})

describe('serializeGenerate', () => {
  it('collects text and returns a chat.completion JSON object', () => {
    const res = mockRes()
    serializeGenerate(
      makeGenerateResult({
        content: [{ type: 'text', text: 'Hi there', providerMetadata: undefined }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
      }),
      'my-model',
      res as never
    )

    const body = res.getJson() as Record<string, unknown>
    expect(body.object).toBe('chat.completion')
    expect(body.model).toBe('my-model')
    const choices = body.choices as Array<{
      message: { content: string; role: string }
      finish_reason: string
    }>
    expect(choices[0].message.content).toBe('Hi there')
    expect(choices[0].finish_reason).toBe('stop')
  })

  it('includes usage tokens in the response', () => {
    const res = mockRes()
    serializeGenerate(
      makeGenerateResult({
        content: [{ type: 'text', text: 'ok', providerMetadata: undefined }],
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
      }),
      'my-model',
      res as never
    )

    const body = res.getJson() as Record<string, unknown>
    const usage = body.usage as Record<string, number>
    expect(usage.prompt_tokens).toBe(10)
    expect(usage.completion_tokens).toBe(5)
    expect(usage.total_tokens).toBe(15)
  })

  it('returns tool_calls in the message for tool-call content', () => {
    const res = mockRes()
    serializeGenerate(
      makeGenerateResult({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'get_weather',
            input: '{"city":"London"}',
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
      }),
      'my-model',
      res as never
    )

    const body = res.getJson() as Record<string, unknown>
    const message = (body.choices as Array<{ message: Record<string, unknown> }>)[0].message
    expect(message['content']).toBeNull()
    const toolCalls = message['tool_calls'] as Array<Record<string, unknown>>
    expect(Array.isArray(toolCalls)).toBe(true)
    expect(toolCalls[0]['id']).toBe('call-1')
    expect((toolCalls[0]['function'] as Record<string, unknown>)['name']).toBe('get_weather')
    expect((toolCalls[0]['function'] as Record<string, unknown>)['arguments']).toBe(
      '{"city":"London"}'
    )
  })
})
