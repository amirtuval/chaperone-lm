import { describe, it, expect } from 'vitest'
import { serializeAnthropicGenerate, serializeAnthropicStream } from './anthropic-serialize.js'
import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { convertArrayToReadableStream } from 'ai/test'

function makeGenerateResult(
  overrides: Partial<LanguageModelV3GenerateResult> = {}
): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text: 'Hello!' }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 3, text: 3, reasoning: 0 },
    },
    warnings: [],
    ...overrides,
  }
}

function makeFakeRes() {
  const chunks: unknown[] = []
  return {
    json: (data: unknown) => chunks.push(data),
    body: chunks,
  }
}

function makeStreamRes() {
  const events: string[] = []
  return {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (data: unknown) => {
      if (data instanceof Uint8Array) {
        events.push(new TextDecoder().decode(data))
      } else {
        events.push(String(data))
      }
    },
    end: () => {},
    get events() {
      return events
    },
  }
}

describe('serializeAnthropicGenerate', () => {
  it('returns a message object with correct shape', () => {
    const res = makeFakeRes()
    serializeAnthropicGenerate(makeGenerateResult(), 'my-alias', res as never)
    const body = res.body[0] as Record<string, unknown>
    expect(body.type).toBe('message')
    expect(body.role).toBe('assistant')
    expect(body.model).toBe('my-alias')
    expect(body.stop_reason).toBe('end_turn')
  })

  it('maps finish reason tool-calls → tool_use', () => {
    const res = makeFakeRes()
    serializeAnthropicGenerate(
      makeGenerateResult({ finishReason: { unified: 'tool-calls', raw: 'tool_calls' } }),
      'alias',
      res as never
    )
    expect((res.body[0] as Record<string, unknown>).stop_reason).toBe('tool_use')
  })

  it('maps finish reason length → max_tokens', () => {
    const res = makeFakeRes()
    serializeAnthropicGenerate(
      makeGenerateResult({ finishReason: { unified: 'length', raw: 'length' } }),
      'alias',
      res as never
    )
    expect((res.body[0] as Record<string, unknown>).stop_reason).toBe('max_tokens')
  })

  it('includes text and tool_use content blocks', () => {
    const res = makeFakeRes()
    serializeAnthropicGenerate(
      makeGenerateResult({
        content: [
          { type: 'text', text: 'Calling tool' },
          {
            type: 'tool-call',
            toolCallId: 'tc1',
            toolName: 'get_weather',
            input: '{"city":"NYC"}',
          },
        ],
      }),
      'alias',
      res as never
    )
    const content = (res.body[0] as Record<string, unknown[]>).content
    expect(content[0]).toMatchObject({ type: 'text', text: 'Calling tool' })
    expect(content[1]).toMatchObject({
      type: 'tool_use',
      id: 'tc1',
      name: 'get_weather',
      input: { city: 'NYC' },
    })
  })

  it('reports usage tokens', () => {
    const res = makeFakeRes()
    serializeAnthropicGenerate(makeGenerateResult(), 'alias', res as never)
    const body = res.body[0] as Record<string, Record<string, number>>
    expect(body.usage.input_tokens).toBe(5)
    expect(body.usage.output_tokens).toBe(3)
  })
})

describe('serializeAnthropicStream', () => {
  it('emits message_start, content_block_start, delta, stop, message_stop events', async () => {
    const parts: LanguageModelV3StreamPart[] = [
      { type: 'text-delta', id: '1', delta: 'Hi' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
      },
    ]
    const stream = convertArrayToReadableStream(parts)
    const res = makeStreamRes()
    await serializeAnthropicStream(stream, 'alias', res as never)

    const allText = res.events.join('')
    expect(allText).toContain('message_start')
    expect(allText).toContain('content_block_start')
    expect(allText).toContain('text_delta')
    expect(allText).toContain('message_delta')
    expect(allText).toContain('message_stop')
    expect(allText).toContain('"Hi"')
  })

  it('emits tool_use content block for tool-input-start', async () => {
    const parts: LanguageModelV3StreamPart[] = [
      { type: 'tool-input-start', id: 'tc1', toolName: 'fn' },
      { type: 'tool-input-delta', id: 'tc1', delta: '{"a":1}' },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
      },
    ]
    const stream = convertArrayToReadableStream(parts)
    const res = makeStreamRes()
    await serializeAnthropicStream(stream, 'alias', res as never)

    const allText = res.events.join('')
    expect(allText).toContain('"tool_use"')
    expect(allText).toContain('"fn"')
    expect(allText).toContain('input_json_delta')
    expect(allText).toContain('tool_use')
  })
})
