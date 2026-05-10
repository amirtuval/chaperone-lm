import { describe, it, expect } from 'vitest'
import { AzureAdapter } from './azure.js'
import type { GatewayRequest } from './types.js'

const adapter = new AzureAdapter()

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as GatewayRequest
}

describe('AzureAdapter.transformRequest', () => {
  it('passes through a regular request', () => {
    const result = adapter.transformRequest(makeReq())
    expect(result).not.toHaveProperty('writeError')
  })

  it('strips non-OpenAI providerOptions', () => {
    const req = makeReq({ providerOptions: { anthropic: { thinking: true }, openai: { x: 1 } } })
    const result = adapter.transformRequest(req) as GatewayRequest
    const opts = result.providerOptions as Record<string, unknown>
    expect(opts['anthropic']).toBeUndefined()
    expect(opts['openai']).toBeDefined()
  })

  it('rewrites max_tokens for o1 models and removes temperature', () => {
    const req = makeReq({ model: 'o1-preview', max_tokens: 800, temperature: 0.9 })
    const result = adapter.transformRequest(req) as GatewayRequest
    expect(result.max_tokens).toBeUndefined()
    expect(result.temperature).toBeUndefined()
    const openaiOpts = (result.providerOptions as Record<string, unknown>)?.['openai'] as Record<string, unknown>
    expect(openaiOpts?.['maxCompletionTokens']).toBe(800)
  })
})
