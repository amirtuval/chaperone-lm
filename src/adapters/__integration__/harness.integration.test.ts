/**
 * Harness integration tests — validate OpenAI-protocol compliance using the
 * official openai npm SDK as a real client.
 *
 * Unlike the supertest-based provider suite (which inspects raw HTTP text),
 * the OpenAI SDK does strict schema validation on every response field. Any
 * protocol deviation (wrong finish_reason values, malformed SSE chunks,
 * missing fields) will surface here as SDK parsing errors — the same errors
 * that opencode, Codex, and other OpenAI-compatible clients would raise.
 *
 * Required env vars (at least one must be present to run any tests):
 *   ANTHROPIC_API_KEY  — tests claude-haiku-4-5 via Anthropic direct
 *   OPENAI_API_KEY     — tests gpt-4o-mini via OpenAI direct
 *   VERTEX_PROJECT     — tests gemini-2.0-flash via Vertex AI
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import OpenAI from 'openai'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

async function startServer(config: AppConfig): Promise<{ baseURL: string; stop: () => void }> {
  const app = createApp(config, buildAdapterRegistry(config.channels))
  const server = createServer(app)

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  const baseURL = `http://127.0.0.1:${addr.port}/v1`

  return { baseURL, stop: () => server.close() }
}

// ---------------------------------------------------------------------------
// Shared harness test suite
// ---------------------------------------------------------------------------

const GET_WEATHER_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
}

function runHarnessSuite(label: string, getClient: () => OpenAI, model: string) {
  describe(label, () => {
    const timeout = 60_000 * 4

    it(
      'non-streaming: SDK parses a valid chat.completion response',
      async () => {
        const res = await getClient().chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
          stream: false,
        })

        expect(res.object).toBe('chat.completion')
        expect(res.choices[0].message.role).toBe('assistant')
        expect(typeof res.choices[0].message.content).toBe('string')
        expect(res.choices[0].message.content!.length).toBeGreaterThan(0)
        expect(res.choices[0].finish_reason).toBe('stop')
        expect(res.usage?.prompt_tokens).toBeGreaterThan(0)
      },
      timeout
    )

    it(
      'streaming: SDK parses all SSE chunks and accumulates text',
      async () => {
        const stream = await getClient().chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Say exactly the word: hello' }],
          stream: true,
        })

        const chunks: OpenAI.ChatCompletionChunk[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }

        expect(chunks.length).toBeGreaterThan(0)
        for (const c of chunks) {
          expect(c.object).toBe('chat.completion.chunk')
        }

        const text = chunks
          .flatMap((c) => c.choices)
          .map((ch) => ch.delta.content ?? '')
          .join('')
        expect(text.length).toBeGreaterThan(0)

        const finishChunk = chunks.find((c) => c.choices[0]?.finish_reason != null)
        expect(finishChunk?.choices[0].finish_reason).toBe('stop')
      },
      timeout
    )

    it(
      'tool call (non-streaming): finish_reason is tool_calls, arguments are valid JSON',
      async () => {
        const res = await getClient().chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'What is the weather in London?' }],
          tools: [GET_WEATHER_TOOL],
          tool_choice: 'auto',
          stream: false,
        })

        expect(res.choices[0].finish_reason).toBe('tool_calls')
        const toolCall = res.choices[0].message.tool_calls?.[0]
        expect(toolCall).toBeDefined()
        expect(toolCall!.type).toBe('function')
        expect(toolCall!.function.name).toBe('get_weather')
        const args = JSON.parse(toolCall!.function.arguments)
        expect(typeof args.city).toBe('string')
      },
      timeout
    )

    it(
      'multi-turn tool round-trip: gateway correctly handles tool result messages',
      async () => {
        const client = getClient()

        // First turn: model calls the tool
        const first = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is the weather in London?' },
          ],
          tools: [GET_WEATHER_TOOL],
          tool_choice: 'auto',
          stream: false,
        })

        expect(first.choices[0].finish_reason).toBe('tool_calls')
        const toolCall = first.choices[0].message.tool_calls![0]

        // Second turn: inject tool result, expect a final text answer
        const second = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is the weather in London?' },
            first.choices[0].message,
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: '{"temperature": 15, "condition": "cloudy"}',
            },
          ],
          stream: false,
        })

        expect(second.choices[0].finish_reason).toBe('stop')
        expect(second.choices[0].message.content?.length).toBeGreaterThan(0)
      },
      timeout
    )

    it(
      'streaming tool call: finish_reason chunk carries tool_calls, arguments accumulate',
      async () => {
        const stream = await getClient().chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'What is the weather in London?' }],
          tools: [GET_WEATHER_TOOL],
          tool_choice: 'auto',
          stream: true,
        })

        const chunks: OpenAI.ChatCompletionChunk[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }

        // Must have a chunk with tool call id + name
        const startChunk = chunks.find((c) => c.choices[0]?.delta?.tool_calls?.[0]?.id != null)
        expect(startChunk).toBeDefined()
        expect(startChunk!.choices[0].delta.tool_calls![0].function?.name).toBe('get_weather')

        // Accumulated arguments must be valid JSON
        const args = chunks
          .flatMap((c) => c.choices[0]?.delta?.tool_calls ?? [])
          .map((tc) => tc.function?.arguments ?? '')
          .join('')
        expect(() => JSON.parse(args)).not.toThrow()

        const finishChunk = chunks.find((c) => c.choices[0]?.finish_reason != null)
        expect(finishChunk?.choices[0].finish_reason).toBe('tool_calls')
      },
      timeout
    )
  })
}

// ---------------------------------------------------------------------------
// Per-provider suites
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const VERTEX_PROJECT = process.env.VERTEX_PROJECT

describe.skipIf(!ANTHROPIC_API_KEY)(
  'OpenAI SDK harness → Anthropic direct (claude-haiku-4-5)',
  () => {
    let baseURL: string
    let stop: () => void

    beforeAll(async () => {
      const config: AppConfig = {
        channels: [{ name: 'anthropic', type: 'anthropic', apiKey: ANTHROPIC_API_KEY! }],
        models: { 'claude-haiku': { channel: 'anthropic', model: 'claude-haiku-4-5' } },
      }
      ;({ baseURL, stop } = await startServer(config))
    })
    afterAll(() => stop())

    runHarnessSuite(
      'Anthropic direct',
      () => new OpenAI({ apiKey: 'local', baseURL }),
      'claude-haiku'
    )
  }
)

describe.skipIf(!OPENAI_API_KEY)('OpenAI SDK harness → OpenAI direct (gpt-4o-mini)', () => {
  let baseURL: string
  let stop: () => void

  beforeAll(async () => {
    const config: AppConfig = {
      channels: [{ name: 'openai', type: 'openai', apiKey: OPENAI_API_KEY! }],
      models: { 'gpt-4o-mini': { channel: 'openai', model: 'gpt-4o-mini' } },
    }
    ;({ baseURL, stop } = await startServer(config))
  })
  afterAll(() => stop())

  runHarnessSuite(
    'OpenAI direct',
    () => new OpenAI({ apiKey: 'local', baseURL }),
    'gpt-4o-mini'
  )
})

const VERTEX_GEMINI_MODEL = process.env.VERTEX_GEMINI_MODEL ?? 'gemini-2.5-flash'

describe.skipIf(!VERTEX_PROJECT)(
  `OpenAI SDK harness → Vertex Gemini (${VERTEX_GEMINI_MODEL})`,
  () => {
    let baseURL: string
    let stop: () => void

    beforeAll(async () => {
      const config: AppConfig = {
        channels: [
          {
            name: 'vertex-gemini',
            type: 'vertex',
            project: VERTEX_PROJECT!,
            region: 'us-central1',
            provider: 'gemini',
          },
        ],
        models: { 'gemini-flash': { channel: 'vertex-gemini', model: VERTEX_GEMINI_MODEL } },
      }
      ;({ baseURL, stop } = await startServer(config))
    })
    afterAll(() => stop())

    runHarnessSuite(
      'Vertex Gemini',
      () => new OpenAI({ apiKey: 'local', baseURL }),
      'gemini-flash'
    )
  }
)
