import { describe, it, expect } from 'vitest'
import { OpenAICompatibleAdapter } from './openai-compatible.js'
import type { GatewayRequest } from './types.js'

const adapter = new OpenAICompatibleAdapter()

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    model: 'meta/llama-3-70b',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as GatewayRequest
}

describe('OpenAICompatibleAdapter.transformRequest', () => {
  it('returns the request unchanged', () => {
    const req = makeReq()
    const result = adapter.transformRequest(req)
    expect(result).toBe(req)
  })

  it('preserves arbitrary fields', () => {
    const req = makeReq({ providerOptions: { custom: { foo: 'bar' } } })
    const result = adapter.transformRequest(req) as GatewayRequest
    expect((result.providerOptions as Record<string, unknown>)?.['custom']).toEqual({ foo: 'bar' })
  })
})

describe('OpenAICompatibleAdapter.transformResponse', () => {
  it('passes stream parts through unchanged', async () => {
    async function* source() {
      yield { type: 'text-delta' as const, id: '1', delta: 'hi' }
    }
    const parts = []
    for await (const p of adapter.transformResponse(source())) {
      parts.push(p)
    }
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ delta: 'hi' })
  })
})
