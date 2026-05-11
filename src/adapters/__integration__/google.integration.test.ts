import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'

const config: AppConfig = {
  channels: [
    {
      name: 'google-test',
      type: 'google',
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
    },
  ],
  models: {
    'gemini-flash': { channel: 'google-test', model: 'gemini-2.0-flash-lite' },
  },
}

describe.skipIf(!process.env.GOOGLE_GENERATIVE_AI_API_KEY)(
  'Google adapter — integration',
  () => {
    const registry = buildAdapterRegistry(config.channels)
    const app = createApp(config, registry)

    it(
      'returns a non-streaming response (stream: false)',
      async () => {
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gemini-flash',
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
            stream: false,
          })

        expect(res.status).toBe(200)
        expect(res.body.object).toBe('chat.completion')
        expect(res.body.choices[0].message.role).toBe('assistant')
        expect(typeof res.body.choices[0].message.content).toBe('string')
        expect(res.body.choices[0].message.content.length).toBeGreaterThan(0)
        expect(res.body.usage.prompt_tokens).toBeGreaterThan(0)
        expect(res.body.choices[0].finish_reason).toBe('stop')
      },
      30000
    )

    it(
      'returns SSE chunks (stream: true)',
      async () => {
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gemini-flash',
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
            stream: true,
          })

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/event-stream')

        const lines = res.text.split('\n').filter((l) => l.startsWith('data: '))
        const lastDataLine = lines[lines.length - 1]
        expect(lastDataLine).toBe('data: [DONE]')

        const contentChunks = lines
          .filter((l) => l !== 'data: [DONE]')
          .map((l) => {
            try {
              return JSON.parse(l.slice('data: '.length))
            } catch {
              return null
            }
          })
          .filter(
            (chunk) =>
              chunk !== null &&
              typeof chunk.choices?.[0]?.delta?.content === 'string' &&
              chunk.choices[0].delta.content.length > 0
          )

        expect(contentChunks.length).toBeGreaterThan(0)
      },
      30000
    )

    it(
      'handles multiple system messages (stream: false)',
      async () => {
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gemini-flash',
            messages: [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'system', content: 'Always respond concisely.' },
              { role: 'user', content: 'Say exactly the word: hello' },
            ],
            stream: false,
          })

        expect(res.status).toBe(200)
        expect(res.body.object).toBe('chat.completion')
        expect(res.body.choices[0].message.role).toBe('assistant')
      },
      30000
    )

    it(
      'returns 404 for an unknown model alias',
      async () => {
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'nonexistent-model',
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
          })

        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('model_not_found')
      },
      30000
    )
  }
)
