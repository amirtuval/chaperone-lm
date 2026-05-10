import { describe, it, expect, vi } from 'vitest'
import { AnthropicAdapter } from './anthropic.js'
import type { GatewayRequest } from './types.js'

const adapter = new AnthropicAdapter()

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as GatewayRequest
}

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

describe('AnthropicAdapter.transformRequest', () => {
  it('passes through a simple request unchanged', () => {
    const req = makeReq()
    const result = adapter.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect(result).toMatchObject({ model: 'claude-sonnet-4-5' })
  })

  it('merges multiple system messages into one', () => {
    const req = makeReq({
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hi' },
      ],
    })
    const result = adapter.transformRequest(req) as GatewayRequest
    const systemMessages = result.messages.filter(m => m.role === 'system')
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0].content).toBe('Be helpful.\n\nBe concise.')
  })

  it('leaves a single system message unchanged', () => {
    const req = makeReq({
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hi' },
      ],
    })
    const result = adapter.transformRequest(req) as GatewayRequest
    const systemMessages = result.messages.filter(m => m.role === 'system')
    expect(systemMessages).toHaveLength(1)
  })

  it('maps reasoning_effort low → budget 2000 and forces temperature 1', () => {
    const req = makeReq({ reasoning_effort: 'low' })
    const result = adapter.transformRequest(req) as GatewayRequest
    expect(result.temperature).toBe(1)
    const anthropicOptions = (result.providerOptions as Record<string, unknown>)?.['anthropic'] as Record<string, unknown>
    expect(anthropicOptions?.['thinking']).toMatchObject({ type: 'enabled', budgetTokens: 2000 })
  })

  it('maps reasoning_effort medium → budget 8000', () => {
    const req = makeReq({ reasoning_effort: 'medium' })
    const result = adapter.transformRequest(req) as GatewayRequest
    const anthropicOptions = (result.providerOptions as Record<string, unknown>)?.['anthropic'] as Record<string, unknown>
    expect(anthropicOptions?.['thinking']).toMatchObject({ budgetTokens: 8000 })
  })

  it('maps reasoning_effort high → budget 16000', () => {
    const req = makeReq({ reasoning_effort: 'high' })
    const result = adapter.transformRequest(req) as GatewayRequest
    const anthropicOptions = (result.providerOptions as Record<string, unknown>)?.['anthropic'] as Record<string, unknown>
    expect(anthropicOptions?.['thinking']).toMatchObject({ budgetTokens: 16000 })
  })

  it('does not add thinking options when reasoning_effort is absent', () => {
    const req = makeReq()
    const result = adapter.transformRequest(req) as GatewayRequest
    const anthropicOptions = (result.providerOptions as Record<string, unknown> | undefined)?.['anthropic']
    expect(anthropicOptions).toBeUndefined()
  })

  it('returns AdapterRequestError for unknown reasoning_effort value', () => {
    const req = makeReq({ reasoning_effort: 'ultra' as GatewayRequest['reasoning_effort'] })
    const result = adapter.transformRequest(req)
    expect(result).toHaveProperty('writeError')
    const res = mockRes()
    ;(result as unknown as { writeError: (r: typeof res) => void }).writeError(res as never)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('AnthropicAdapter.transformResponse', () => {
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
