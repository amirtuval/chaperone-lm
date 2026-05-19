import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { LanguageModelV3StreamPart, LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { createApp } from '../server.js'
import type { AppConfig } from '../types.js'
import type {
  CompletionsProviderAdapter,
  GatewayRequest,
  AdapterRequestError,
} from '../adapters/types.js'
import { AISdkCompletionsAdapter } from '../adapters/aisdk-completions.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function partsToGenerateResult(parts: any[]): LanguageModelV3GenerateResult {
  let text = ''
  let finishReason: LanguageModelV3GenerateResult['finishReason'] = { unified: 'stop', raw: 'stop' }
  let usage: LanguageModelV3GenerateResult['usage'] = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  }
  for (const part of parts) {
    if (part.type === 'text-delta') text += part.delta
    else if (part.type === 'finish') {
      finishReason = part.finishReason
      usage = part.usage
    }
  }
  return {
    content: text ? [{ type: 'text', text }] : [],
    finishReason,
    usage,
    warnings: [],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeModel(parts: any[]): LanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream(parts as LanguageModelV3StreamPart[]),
    }),
    doGenerate: async () => partsToGenerateResult(parts),
  })
}

const config: AppConfig = {
  channels: [{ name: 'test-channel', type: 'openai', apiKey: 'test' }],
  models: {
    'test-model': { channel: 'test-channel', model: 'gpt-4o-test' },
  },
}

describe('POST /v1/chat/completions', () => {
  it('returns 404 for an unknown model', async () => {
    const adapter = new AISdkCompletionsAdapter(makeModel([]))
    // Registry keyed by alias
    const registry = new Map<string, CompletionsProviderAdapter>([['test-model', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'nonexistent', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('model_not_found')
  })

  it('returns a non-streaming chat.completion for stream: false', async () => {
    const adapter = new AISdkCompletionsAdapter(
      makeModel([
        { type: 'text-delta', id: '1', delta: 'Hello!' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 3, text: 3, reasoning: 0 },
          },
        },
      ])
    )
    const registry = new Map<string, CompletionsProviderAdapter>([['test-model', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: false })
    expect(res.status).toBe(200)
    expect(res.body.object).toBe('chat.completion')
    expect(res.body.choices[0].message.content).toBe('Hello!')
  })

  it('returns SSE chunks for stream: true', async () => {
    const adapter = new AISdkCompletionsAdapter(
      makeModel([
        { type: 'text-delta', id: '1', delta: 'Streaming!' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 3, text: 3, reasoning: 0 },
          },
        },
      ])
    )
    const registry = new Map<string, CompletionsProviderAdapter>([['test-model', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.text).toContain('data: ')
    expect(res.text).toContain('[DONE]')
  })

  it('returns the adapter error when transformFn rejects', async () => {
    const rejectingTransform = (_req: GatewayRequest): GatewayRequest | AdapterRequestError => ({
      writeError: (res) =>
        res
          .status(422)
          .json({ error: { message: 'Rejected by adapter', type: 'invalid_request_error' } }),
    })
    const adapter = new AISdkCompletionsAdapter(makeModel([]), rejectingTransform)
    const registry = new Map<string, CompletionsProviderAdapter>([['test-model', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toBe('Rejected by adapter')
  })
})
