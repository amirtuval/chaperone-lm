import { describe, it, expect } from 'vitest'
import { resolveRoute } from './resolver.js'
import type { AppConfig } from '../types.js'
import type { ProviderAdapter } from '../adapters/types.js'

const fakeAdapter = {} as ProviderAdapter

const config: AppConfig = {
  channels: [
    { name: 'ant', type: 'anthropic', apiKey: 'key' },
    { name: 'oai', type: 'openai', apiKey: 'key' },
  ],
  models: {
    'claude-sonnet': { channel: 'ant', model: 'claude-sonnet-4-5' },
    'gpt-4o': { channel: 'oai', model: 'gpt-4o', deploymentId: 'my-deployment' },
  },
}

const registry = new Map<string, ProviderAdapter>([
  ['ant', fakeAdapter],
  ['oai', fakeAdapter],
])

describe('resolveRoute', () => {
  it('resolves a known alias to the correct channel and model', () => {
    const route = resolveRoute('claude-sonnet', config, registry)
    expect(route).not.toBeNull()
    expect(route!.channelConfig.name).toBe('ant')
    expect(route!.upstreamModelId).toBe('claude-sonnet-4-5')
    expect(route!.adapter).toBe(fakeAdapter)
  })

  it('includes deploymentId when present', () => {
    const route = resolveRoute('gpt-4o', config, registry)
    expect(route!.deploymentId).toBe('my-deployment')
  })

  it('returns null for an unknown alias', () => {
    const route = resolveRoute('does-not-exist', config, registry)
    expect(route).toBeNull()
  })

  it('returns null when alias exists but channel is missing from registry', () => {
    const emptyRegistry = new Map<string, ProviderAdapter>()
    const route = resolveRoute('claude-sonnet', config, emptyRegistry)
    expect(route).toBeNull()
  })
})
