import { describe, it, expect, vi } from 'vitest'
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

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

describe('VertexAdapter.transformRequest', () => {
  it('passes through a request unchanged', () => {
    const req = makeReq()
    const result = adapter.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect(result).toMatchObject({ model: 'gemini-2.0-flash' })
  })
})

describe('VertexAdapter.transformRequest — provider: anthropic', () => {
  it('applies anthropic transforms without calling createModel first (regression: mutable activeProvider)', () => {
    // transformRequest must behave correctly from the very first call.
    // Previously, activeProvider was set as a side-effect of createModel, which
    // runs *after* transformRequest in the request pipeline — so the first
    // request to an anthropic Vertex channel silently skipped transforms.
    const a = new VertexAdapter('anthropic')
    const req = makeReq({
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hi' },
      ],
    })
    const result = a.transformRequest(req) as GatewayRequest
    expect(result).not.toHaveProperty('writeError')
    const systemMessages = result.messages.filter((m) => m.role === 'system')
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0].content).toBe('Be helpful.\n\nBe concise.')
  })

  it('merges multiple system messages into one', () => {
    const a = new VertexAdapter('anthropic')
    const req = makeReq({
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hi' },
      ],
    })
    const result = a.transformRequest(req) as GatewayRequest
    expect(result).not.toHaveProperty('writeError')
    const systemMessages = result.messages.filter((m) => m.role === 'system')
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0].content).toBe('Be helpful.\n\nBe concise.')
  })

  it('maps reasoning_effort low → budgetTokens 2000 and forces temperature 1', () => {
    const a = new VertexAdapter('anthropic')
    const req = makeReq({ reasoning_effort: 'low' })
    const result = a.transformRequest(req) as GatewayRequest
    expect(result).not.toHaveProperty('writeError')
    expect(result.temperature).toBe(1)
    const anthropicOptions = (result.providerOptions as Record<string, unknown>)?.['anthropic'] as
      | Record<string, unknown>
      | undefined
    expect(anthropicOptions?.['thinking']).toMatchObject({ type: 'enabled', budgetTokens: 2000 })
  })

  it('returns AdapterRequestError for unknown reasoning_effort value', () => {
    const a = new VertexAdapter('anthropic')
    const req = makeReq({ reasoning_effort: 'ultra' as GatewayRequest['reasoning_effort'] })
    const result = a.transformRequest(req)
    expect(result).toHaveProperty('writeError')
    const res = mockRes()
    ;(result as unknown as { writeError: (r: typeof res) => void }).writeError(res as never)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('VertexAdapter.transformRequest — non-anthropic providers', () => {
  it('passes through unchanged when provider is gemini (explicit)', () => {
    const a = new VertexAdapter('gemini')
    const req = makeReq()
    const result = a.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect(result).toMatchObject({ model: 'gemini-2.0-flash' })
  })

  it('passes through unchanged when provider is omitted (defaults to gemini)', () => {
    const a = new VertexAdapter()
    const req = makeReq()
    const result = a.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect(result).toMatchObject({ model: 'gemini-2.0-flash' })
  })

  it('passes through unchanged when provider is maas', () => {
    const a = new VertexAdapter('maas')
    const req = makeReq()
    const result = a.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect(result).toMatchObject({ model: 'gemini-2.0-flash' })
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
