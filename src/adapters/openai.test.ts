import { describe, it, expect } from 'vitest'
import { OpenAIAdapter } from './openai.js'
import type { GatewayRequest } from './types.js'

const adapter = new OpenAIAdapter()

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as GatewayRequest
}

describe('OpenAIAdapter.transformRequest', () => {
  it('passes through a regular request unchanged', () => {
    const req = makeReq()
    const result = adapter.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect((result as GatewayRequest).model).toBe('gpt-4o')
  })

  it('strips non-OpenAI providerOptions (anthropic, google) but keeps openai options', () => {
    const req = makeReq({
      providerOptions: { anthropic: { thinking: true }, google: { safetySettings: [] }, openai: { foo: 'bar' } },
    })
    const result = adapter.transformRequest(req) as GatewayRequest
    const opts = result.providerOptions as Record<string, unknown>
    expect(opts['anthropic']).toBeUndefined()
    expect(opts['google']).toBeUndefined()
    expect((opts['openai'] as Record<string, unknown>)?.['foo']).toBe('bar')
  })

  it('rewrites max_tokens → maxCompletionTokens and removes temperature for o1 models', () => {
    const req = makeReq({ model: 'o1-mini', max_tokens: 1000, temperature: 0.5 })
    const result = adapter.transformRequest(req) as GatewayRequest
    expect(result.max_tokens).toBeUndefined()
    expect(result.temperature).toBeUndefined()
    const openaiOpts = (result.providerOptions as Record<string, unknown>)?.['openai'] as Record<string, unknown>
    expect(openaiOpts?.['maxCompletionTokens']).toBe(1000)
  })

  it('rewrites max_tokens → maxCompletionTokens for o3 models', () => {
    const req = makeReq({ model: 'o3-mini', max_tokens: 2000, temperature: 1 })
    const result = adapter.transformRequest(req) as GatewayRequest
    expect(result.max_tokens).toBeUndefined()
    const openaiOpts = (result.providerOptions as Record<string, unknown>)?.['openai'] as Record<string, unknown>
    expect(openaiOpts?.['maxCompletionTokens']).toBe(2000)
  })

  it('does not rewrite max_tokens for regular GPT models', () => {
    const req = makeReq({ model: 'gpt-4o', max_tokens: 500, temperature: 0.7 })
    const result = adapter.transformRequest(req) as GatewayRequest
    expect(result.max_tokens).toBe(500)
    expect(result.temperature).toBe(0.7)
  })
})
