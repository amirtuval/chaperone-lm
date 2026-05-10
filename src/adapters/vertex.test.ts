import { describe, it, expect } from 'vitest'
import { VertexAdapter } from './vertex.js'
import type { GatewayRequest } from './types.js'
import type { ChannelConfig } from '../types.js'

const adapter = new VertexAdapter()

function baseChannel(
  provider?: 'gemini' | 'anthropic' | 'maas'
): Extract<ChannelConfig, { type: 'vertex' }> {
  return {
    name: 'vertex-test',
    type: 'vertex',
    project: 'my-project',
    region: 'us-central1',
    ...(provider ? { provider } : {}),
  }
}

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    model: 'gemini-2.0-flash',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as GatewayRequest
}

describe('VertexAdapter.transformRequest', () => {
  it('passes through a request unchanged', () => {
    const req = makeReq()
    const result = adapter.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect(result).toMatchObject({ model: 'gemini-2.0-flash' })
  })
})

describe('VertexAdapter.transformResponse', () => {
  it('passes stream parts through unchanged', async () => {
    async function* source() {
      yield { type: 'text-delta' as const, id: '1', delta: 'hello' }
      yield { type: 'text-delta' as const, id: '2', delta: ' world' }
    }
    const parts = []
    for await (const p of adapter.transformResponse(source())) {
      parts.push(p)
    }
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ delta: 'hello' })
  })
})

describe('VertexAdapter.createModel', () => {
  it('throws if the channel type is not vertex', () => {
    const wrongConfig: ChannelConfig = { name: 'oai', type: 'openai', apiKey: 'key' }
    expect(() => adapter.createModel(wrongConfig, 'gemini-2.0-flash')).toThrow(
      'VertexAdapter: expected vertex channel config'
    )
  })

  it('returns a model object when provider is omitted (defaults to gemini)', () => {
    const model = adapter.createModel(baseChannel(), 'gemini-2.0-flash')
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })

  it('returns a model object when provider is explicitly gemini', () => {
    const model = adapter.createModel(baseChannel('gemini'), 'gemini-2.0-flash')
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })

  it('returns a model object when provider is anthropic', () => {
    const model = adapter.createModel(baseChannel('anthropic'), 'claude-sonnet-4-5@20250929')
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })

  it('returns a model object when provider is maas', () => {
    const model = adapter.createModel(
      baseChannel('maas'),
      'meta/llama-4-maverick-17b-128e-instruct-maas'
    )
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })
})
