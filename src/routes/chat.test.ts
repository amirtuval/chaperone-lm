import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import type { LanguageModel } from 'ai'
import { createApp } from '../server.js'
import type { AppConfig, ChannelConfig } from '../types.js'
import type { GatewayRequest, AdapterRequestError } from '../adapters/types.js'
import { AISdkAdapter } from '../adapters/aisdk-base.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeModel(parts: any[]): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stream: convertArrayToReadableStream(parts as any),
    }),
  })
}

class MockAdapter extends AISdkAdapter {
  constructor(private readonly model: LanguageModel) {
    super()
  }
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    return req
  }
  createModel(_channelConfig: unknown, _modelId: string): LanguageModel {
    return this.model
  }
}

class RejectingAdapter extends AISdkAdapter {
  transformRequest(_req: GatewayRequest): GatewayRequest | AdapterRequestError {
    return {
      writeError: (res) =>
        res
          .status(422)
          .json({ error: { message: 'Rejected by adapter', type: 'invalid_request_error' } }),
    }
  }
  createModel(): LanguageModel {
    return makeModel([])
  }
}

const channel: ChannelConfig = { name: 'test-channel', type: 'openai', apiKey: 'test' }

const config: AppConfig = {
  channels: [channel],
  models: {
    'test-model': { channel: 'test-channel', model: 'gpt-4o-test' },
  },
}

describe('POST /v1/chat/completions', () => {
  it('returns 404 for an unknown model', async () => {
    const adapter = new MockAdapter(makeModel([]))
    const registry = new Map([['test-channel', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'nonexistent', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('model_not_found')
  })

  it('returns a non-streaming chat.completion for stream: false', async () => {
    const adapter = new MockAdapter(
      makeModel([
        { type: 'text-delta', id: '1', delta: 'Hello!' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', provider: 'stop' },
          usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
        },
      ])
    )
    const registry = new Map([['test-channel', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: false })
    expect(res.status).toBe(200)
    expect(res.body.object).toBe('chat.completion')
    expect(res.body.choices[0].message.content).toBe('Hello!')
  })

  it('returns SSE chunks for stream: true', async () => {
    const adapter = new MockAdapter(
      makeModel([
        { type: 'text-delta', id: '1', delta: 'Streaming!' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', provider: 'stop' },
          usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
        },
      ])
    )
    const registry = new Map([['test-channel', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: true })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.text).toContain('data: ')
    expect(res.text).toContain('[DONE]')
  })

  it('returns the adapter error when transformRequest rejects', async () => {
    const adapter = new RejectingAdapter()
    const registry = new Map([['test-channel', adapter]])
    const app = createApp(config, registry)

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toBe('Rejected by adapter')
  })
})
