import { it, expect } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

export interface ProviderSuiteOptions {
  /** Label for the describe block, e.g. 'Google adapter — integration' */
  suiteName?: string
  /** The Express app under test, already wired with real adapter and config */
  app: Express
  /** The model alias to use in requests (must exist in the app config) */
  modelAlias: string
  /** Whether finish_reason must strictly be 'stop' or just truthy */
  strictFinishReason?: boolean
  /**
   * Whether the model supports tool use. Defaults to true.
   * Set to false to skip tool call tests for models that do not support tool use
   * via the ConverseStream API (e.g. Meta Llama models on Bedrock — AWS supports
   * tool use on the Converse API but not on ConverseStream, which the AI SDK always uses).
   */
  supportsTools?: boolean
}

const GET_WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: 'The city name' } },
      required: ['city'],
    },
  },
}

// Test-client retry: the gateway correctly passes 429s through, but integration
// tests should behave like a well-behaved client and back off on rate limits.
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

export function runProviderSuite(options: ProviderSuiteOptions): void {
  const { app, modelAlias, strictFinishReason = true, supportsTools = true } = options
  const itTool = supportsTools ? it : it.skip

  // Base timeout per request; multiplied up to account for retry waits (up to
  // 3 retries × 60s backoff + the actual call time).
  const timeout = 60000 * 4

  it(
    'returns a non-streaming response (stream: false)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/chat/completions')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
            stream: false,
          })
      )

      expect(res.status).toBe(200)
      expect(res.body.object).toBe('chat.completion')
      expect(res.body.choices[0].message.role).toBe('assistant')
      expect(typeof res.body.choices[0].message.content).toBe('string')
      expect(res.body.choices[0].message.content.length).toBeGreaterThan(0)
      expect(res.body.usage.prompt_tokens).toBeGreaterThan(0)
      if (strictFinishReason) {
        expect(res.body.choices[0].finish_reason).toBe('stop')
      } else {
        expect(res.body.choices[0].finish_reason).toBeTruthy()
      }
    },
    timeout
  )

  it(
    'returns a well-formed SSE stream (stream: true)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/chat/completions')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
            stream: true,
          })
      )

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')

      const lines = res.text.split('\n').filter((l) => l.startsWith('data: '))
      expect(lines.at(-1)).toBe('data: [DONE]')

      const chunks = lines
        .filter((l) => l !== 'data: [DONE]')
        .map((l) => JSON.parse(l.slice('data: '.length)))

      // Every chunk has the correct envelope
      for (const c of chunks) {
        expect(c.object).toBe('chat.completion.chunk')
        expect(c.model).toBe(modelAlias)
        expect(typeof c.id).toBe('string')
        expect(typeof c.created).toBe('number')
      }

      // Some providers send usage-only trailing chunks with choices:[]; guard throughout
      const withChoices = (c: { choices?: unknown[] }) =>
        Array.isArray(c.choices) && c.choices.length > 0

      // At least one chunk establishes assistant role

      const roleChunk = chunks.find(
        (c) => withChoices(c) && c.choices[0].delta?.role === 'assistant'
      )
      expect(roleChunk).toBeDefined()

      // At least one chunk carries non-empty text content

      const textChunks = chunks.filter(
        (c) =>
          withChoices(c) &&
          typeof c.choices[0].delta?.content === 'string' &&
          c.choices[0].delta.content.length > 0
      )
      expect(textChunks.length).toBeGreaterThan(0)

      // Find the chunk that carries finish_reason (may not be the last if provider appends usage chunks)

      const finishChunk = chunks.find((c) => withChoices(c) && c.choices[0].finish_reason != null)
      expect(finishChunk).toBeDefined()
      if (strictFinishReason) {
        expect(finishChunk.choices[0].finish_reason).toBe('stop')
      } else {
        expect(finishChunk.choices[0].finish_reason).toBeTruthy()
      }
    },
    timeout
  )

  it(
    'handles multiple system messages (stream: false)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/chat/completions')
          .send({
            model: modelAlias,
            messages: [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'system', content: 'Always respond concisely.' },
              { role: 'user', content: 'Say exactly the word: hello' },
            ],
            stream: false,
          })
      )

      expect(res.status).toBe(200)
      expect(res.body.object).toBe('chat.completion')
      expect(res.body.choices[0].message.role).toBe('assistant')
    },
    timeout
  )

  it('returns 404 for an unknown model alias', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'nonexistent-model',
        messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
      })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('model_not_found')
  }, 60000)

  itTool(
    'returns a tool call in the response (stream: false)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/chat/completions')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'What is the weather in London?' }],
            stream: false,
            tools: [GET_WEATHER_TOOL],
            tool_choice: 'auto',
          })
      )

      expect(res.status).toBe(200)
      expect(res.body.object).toBe('chat.completion')
      const message = res.body.choices[0].message
      expect(message.tool_calls).toBeDefined()
      expect(Array.isArray(message.tool_calls)).toBe(true)
      expect(message.tool_calls.length).toBeGreaterThan(0)
      const call = message.tool_calls[0]
      expect(call.type).toBe('function')
      expect(call.function.name).toBe('get_weather')
      const args = JSON.parse(call.function.arguments)
      expect(typeof args.city).toBe('string')
    },
    timeout
  )

  itTool(
    'streams tool call chunks (stream: true)',
    async () => {
      const res = await withRetry(() =>
        request(app)
          .post('/v1/chat/completions')
          .send({
            model: modelAlias,
            messages: [{ role: 'user', content: 'What is the weather in London?' }],
            stream: true,
            tools: [GET_WEATHER_TOOL],
            tool_choice: 'auto',
          })
      )

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')

      const lines = res.text.split('\n').filter((l) => l.startsWith('data: '))
      expect(lines.at(-1)).toBe('data: [DONE]')

      const chunks = lines
        .filter((l) => l !== 'data: [DONE]')
        .map((l) => {
          try {
            return JSON.parse(l.slice('data: '.length))
          } catch {
            return null
          }
        })
        .filter(Boolean)

      // Must have a chunk that starts the tool call (contains id, type, name)
      const startChunk = chunks.find(
        (c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.id !== undefined
      )
      expect(startChunk).toBeDefined()
      expect(startChunk.choices[0].delta.tool_calls[0].type).toBe('function')
      expect(startChunk.choices[0].delta.tool_calls[0].function.name).toBe('get_weather')

      // Must have at least one argument delta chunk
      const argChunks = chunks.filter(
        (c) =>
          c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments !== undefined &&
          c.choices[0].delta.tool_calls[0].function.arguments !== ''
      )
      expect(argChunks.length).toBeGreaterThan(0)
    },
    timeout
  )
}
