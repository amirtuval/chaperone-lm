import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { AISdkMessagesAdapter } from './aisdk-messages.js'
import type { RouteContext } from './types.js'
import type { ChannelConfig } from '../types.js'

const fakeChannel: ChannelConfig = { name: 'ch', type: 'openai', apiKey: 'key' }
const ctx: RouteContext = { upstreamModelId: 'real-model', channelConfig: fakeChannel }

function makeApp(parts: LanguageModelV3StreamPart[]) {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Hello!' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 3, text: 3, reasoning: 0 },
      },
      warnings: [],
    }),
    doStream: async () => ({ stream: convertArrayToReadableStream(parts) }),
  })

  const adapter = new AISdkMessagesAdapter(model)
  const app = express()
  app.use(express.json())
  app.post('/v1/messages', (req, res) => adapter.handleMessagesRequest(req, res, ctx))
  return app
}

const streamParts: LanguageModelV3StreamPart[] = [
  { type: 'text-delta', id: '1', delta: 'Hello!' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 3, text: 3, reasoning: 0 },
    },
  },
]

describe('AISdkMessagesAdapter', () => {
  it('returns a non-streaming Anthropic message response', async () => {
    const app = makeApp([])
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: false,
      })
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('message')
    expect(res.body.role).toBe('assistant')
    expect(res.body.content[0].text).toBe('Hello!')
    expect(res.body.stop_reason).toBe('end_turn')
  })

  it('returns SSE stream for stream: true', async () => {
    const app = makeApp(streamParts)
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.text).toContain('message_start')
    expect(res.text).toContain('message_stop')
  })

  it('calls transformFn and short-circuits on error', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    const adapter = new AISdkMessagesAdapter(model, () => ({
      writeError: (res) =>
        res
          .status(422)
          .json({ type: 'error', error: { type: 'invalid_request_error', message: 'Bad' } }),
    }))
    const app = express()
    app.use(express.json())
    app.post('/v1/messages', (req, res) => adapter.handleMessagesRequest(req, res, ctx))

    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toBe('Bad')
  })
})
