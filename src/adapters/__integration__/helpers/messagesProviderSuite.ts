import { it, expect } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

export interface MessagesProviderSuiteOptions {
  app: Express
  modelAlias: string
  strictFinishReason?: boolean
  supportsTools?: boolean
}

const GET_WEATHER_TOOL = {
  name: 'get_weather',
  description: 'Get the current weather for a city',
  input_schema: {
    type: 'object',
    properties: { city: { type: 'string', description: 'The city name' } },
    required: ['city'],
  },
}

async function withRetry(
  fn: () => Promise<request.Response>,
  maxRetries = 3
): Promise<request.Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fn()
    if (res.status !== 429) return res
    const retryAfter = res.headers['retry-after']
    const delayMs = retryAfter ? parseFloat(retryAfter) * 1000 : 60000
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return fn()
}

export function runMessagesProviderSuite(options: MessagesProviderSuiteOptions): void {
  const { app, modelAlias, strictFinishReason = true, supportsTools = true } = options
  const itTool = supportsTools ? it : it.skip
  const timeout = 60000 * 4

  it(
    'returns a non-streaming Anthropic message response',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/messages')
          .set('anthropic-version', '2023-06-01')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
            max_tokens: 100,
            stream: false,
          })
      )

      expect(res.status).toBe(200)
      expect(res.body.type).toBe('message')
      expect(res.body.role).toBe('assistant')
      expect(res.body.model).toBe(modelAlias)
      expect(Array.isArray(res.body.content)).toBe(true)
      expect(res.body.content.length).toBeGreaterThan(0)
      expect(res.body.content[0].type).toBe('text')
      expect(typeof res.body.content[0].text).toBe('string')
      expect(res.body.content[0].text.length).toBeGreaterThan(0)
      if (strictFinishReason) {
        expect(res.body.stop_reason).toBe('end_turn')
      } else {
        expect(res.body.stop_reason).toBeTruthy()
      }
      expect(res.body.usage.input_tokens).toBeGreaterThan(0)
      expect(res.body.usage.output_tokens).toBeGreaterThan(0)
    },
    timeout
  )

  it(
    'returns a well-formed SSE stream (stream: true)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/messages')
          .set('anthropic-version', '2023-06-01')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
            max_tokens: 100,
            stream: true,
          })
      )

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')

      const dataLines = res.text
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice('data: '.length)))

      const messageStart = dataLines.find((d) => d.type === 'message_start')
      expect(messageStart).toBeDefined()
      expect(messageStart.message.model).toBe(modelAlias)

      const messageStop = dataLines.find((d) => d.type === 'message_stop')
      expect(messageStop).toBeDefined()

      const textDeltas = dataLines.filter(
        (d) => d.type === 'content_block_delta' && d.delta?.type === 'text_delta'
      )
      expect(textDeltas.length).toBeGreaterThan(0)
    },
    timeout
  )

  it(
    'accepts a string system prompt',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/messages')
          .set('anthropic-version', '2023-06-01')
          .send({
            model: modelAlias,
            system: 'You are a concise assistant.',
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
            max_tokens: 100,
          })
      )

      expect(res.status).toBe(200)
      expect(res.body.type).toBe('message')
    },
    timeout
  )

  it('returns 404 for an unknown model alias', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('anthropic-version', '2023-06-01')
      .send({
        model: 'nonexistent-model',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      })

    expect(res.status).toBe(404)
    expect(res.body.type).toBe('error')
    expect(res.body.error.type).toBe('not_found_error')
  }, 10000)

  itTool(
    'returns a tool call in the response (stream: false)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/messages')
          .set('anthropic-version', '2023-06-01')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'What is the weather in London?' }],
            max_tokens: 200,
            tools: [GET_WEATHER_TOOL],
            tool_choice: { type: 'auto' },
          })
      )

      expect(res.status).toBe(200)
      expect(res.body.type).toBe('message')
      const toolBlocks = res.body.content.filter((b: { type: string }) => b.type === 'tool_use')
      expect(toolBlocks.length).toBeGreaterThan(0)
      expect(toolBlocks[0].name).toBe('get_weather')
      expect(typeof toolBlocks[0].input).toBe('object')
      expect(typeof toolBlocks[0].input.city).toBe('string')
    },
    timeout
  )

  itTool(
    'streams tool call chunks (stream: true)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/messages')
          .set('anthropic-version', '2023-06-01')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'What is the weather in London?' }],
            max_tokens: 200,
            stream: true,
            tools: [GET_WEATHER_TOOL],
            tool_choice: { type: 'auto' },
          })
      )

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')

      const dataLines = res.text
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice('data: '.length)))

      const toolStart = dataLines.find(
        (d) => d.type === 'content_block_start' && d.content_block?.type === 'tool_use'
      )
      expect(toolStart).toBeDefined()
      expect(toolStart.content_block.name).toBe('get_weather')

      const jsonDeltas = dataLines.filter(
        (d) => d.type === 'content_block_delta' && d.delta?.type === 'input_json_delta'
      )
      expect(jsonDeltas.length).toBeGreaterThan(0)
    },
    timeout
  )
}
