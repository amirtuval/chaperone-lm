import { describe, it, expect } from 'vitest'
import { GoogleAdapter } from './google.js'
import type { GatewayRequest } from './types.js'

const adapter = new GoogleAdapter()

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    model: 'gemini-1.5-pro',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as GatewayRequest
}

describe('GoogleAdapter.transformRequest', () => {
  it('passes through a request with no system messages', () => {
    const result = adapter.transformRequest(makeReq())
    expect(result).not.toHaveProperty('writeError')
    const transformed = result as GatewayRequest
    expect(transformed.messages.some(m => m.role === 'system')).toBe(false)
  })

  it('extracts system messages into providerOptions.google.systemInstruction', () => {
    const req = makeReq({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
    })
    const result = adapter.transformRequest(req) as GatewayRequest
    expect(result.messages.some(m => m.role === 'system')).toBe(false)
    const googleOpts = (result.providerOptions as Record<string, unknown>)?.['google'] as Record<string, unknown>
    expect(googleOpts?.['systemInstruction']).toBe('You are helpful.')
  })

  it('concatenates multiple system messages', () => {
    const req = makeReq({
      messages: [
        { role: 'system', content: 'Part one.' },
        { role: 'system', content: 'Part two.' },
        { role: 'user', content: 'Hi' },
      ],
    })
    const result = adapter.transformRequest(req) as GatewayRequest
    const googleOpts = (result.providerOptions as Record<string, unknown>)?.['google'] as Record<string, unknown>
    expect(googleOpts?.['systemInstruction']).toBe('Part one.\n\nPart two.')
  })

  it('applies default safety settings when not present', () => {
    const result = adapter.transformRequest(makeReq()) as GatewayRequest
    const googleOpts = (result.providerOptions as Record<string, unknown>)?.['google'] as Record<string, unknown>
    expect(Array.isArray(googleOpts?.['safetySettings'])).toBe(true)
  })

  it('does not overwrite existing safety settings', () => {
    const customSettings = [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ALL' }]
    const req = makeReq({ providerOptions: { google: { safetySettings: customSettings } } })
    const result = adapter.transformRequest(req) as GatewayRequest
    const googleOpts = (result.providerOptions as Record<string, unknown>)?.['google'] as Record<string, unknown>
    expect(googleOpts?.['safetySettings']).toEqual(customSettings)
  })
})
