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

export function runProviderSuite(options: ProviderSuiteOptions): void {
  const { app, modelAlias, strictFinishReason = true, supportsTools = true } = options
  const itTool = supportsTools ? it : it.skip

  it('returns a non-streaming response (stream: false)', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: modelAlias,
        messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
        stream: false,
      })

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
  }, 30000)

  it('returns a well-formed SSE stream (stream: true)', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: modelAlias,
        messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
        stream: true,
      })

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

    // First chunk establishes role
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: '' })
    expect(chunks[0].choices[0].finish_reason).toBeNull()

    // At least one chunk carries non-empty text content
    const textChunks = chunks.filter(
      (c) => typeof c.choices[0].delta.content === 'string' && c.choices[0].delta.content.length > 0
    )
    expect(textChunks.length).toBeGreaterThan(0)

    // Finish chunk: empty delta, finish_reason strict or truthy
    const finishChunk = chunks.at(-1)
    expect(finishChunk.choices[0].delta).toEqual({})
    if (strictFinishReason) {
      expect(finishChunk.choices[0].finish_reason).toBe('stop')
    } else {
      expect(finishChunk.choices[0].finish_reason).toBeTruthy()
    }
  }, 30000)

  it('handles multiple system messages (stream: false)', async () => {
    const res = await request(app)
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

    expect(res.status).toBe(200)
    expect(res.body.object).toBe('chat.completion')
    expect(res.body.choices[0].message.role).toBe('assistant')
  }, 30000)

  it('returns 404 for an unknown model alias', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'nonexistent-model',
        messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
      })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('model_not_found')
  }, 30000)

  itTool('returns a tool call in the response (stream: false)', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: modelAlias,
        messages: [{ role: 'user', content: 'What is the weather in London?' }],
        stream: false,
        tools: [GET_WEATHER_TOOL],
        tool_choice: 'auto',
      })

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
  }, 30000)

  itTool('streams tool call chunks (stream: true)', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: modelAlias,
        messages: [{ role: 'user', content: 'What is the weather in London?' }],
        stream: true,
        tools: [GET_WEATHER_TOOL],
        tool_choice: 'auto',
      })

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
    const startChunk = chunks.find((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.id !== undefined)
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
  }, 30000)
}
