import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../server.js'
import type { AppConfig } from '../types.js'
import type { MessagesProviderAdapter } from '../adapters/types.js'

function makeMessagesAdapter(): MessagesProviderAdapter {
  return {
    handleMessagesRequest: async (_req, res) => {
      res.json({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'test-alias',
        content: [{ type: 'text', text: 'Hello from adapter' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 3 },
      })
    },
  }
}

const config: AppConfig = {
  channels: [{ name: 'ant', type: 'anthropic', apiKey: 'key' }],
  models: {
    'test-alias': { channel: 'ant', model: 'claude-sonnet-4-5' },
  },
}

const messagesRegistry = new Map<string, MessagesProviderAdapter>([
  ['test-alias', makeMessagesAdapter()],
])

const app = createApp(config, new Map(), messagesRegistry)

describe('POST /v1/messages', () => {
  it('returns 400 when model is missing', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })
    expect(res.status).toBe(400)
    expect(res.body.type).toBe('error')
    expect(res.body.error.type).toBe('invalid_request_error')
  })

  it('returns 404 for unknown model alias', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'nonexistent',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })
    expect(res.status).toBe(404)
    expect(res.body.type).toBe('error')
    expect(res.body.error.type).toBe('not_found_error')
  })

  it('calls the adapter and returns the response', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .send({
        model: 'test-alias',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      })
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('message')
    expect(res.body.content[0].text).toBe('Hello from adapter')
  })
})
