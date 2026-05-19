import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../server.js'
import type { AppConfig } from '../types.js'
import type { CompletionsProviderAdapter } from '../adapters/types.js'

function makeAdapter(): CompletionsProviderAdapter {
  return { handleCompletionsRequest: async () => {} }
}

const config: AppConfig = {
  channels: [
    { name: 'ant', type: 'anthropic', apiKey: 'key' },
    { name: 'oai', type: 'openai', apiKey: 'key' },
    { name: 'vllm', type: 'llm-server', baseUrl: 'http://localhost:8000', protocols: ['openai'] },
  ],
  models: {
    'claude-sonnet': { channel: 'ant', model: 'claude-sonnet-4-5' },
    'gpt-4o': { channel: 'oai', model: 'gpt-4o' },
    'llama-70b': { channel: 'vllm', model: 'meta/llama-3-70b' },
  },
}

// Registry keyed by alias
const registry = new Map<string, CompletionsProviderAdapter>([
  ['claude-sonnet', makeAdapter()],
  ['gpt-4o', makeAdapter()],
  ['llama-70b', makeAdapter()],
])

const app = createApp(config, registry)

describe('GET /v1/models', () => {
  it('returns a list of all configured model aliases', async () => {
    const res = await request(app).get('/v1/models')
    expect(res.status).toBe(200)
    expect(res.body.object).toBe('list')
    expect(res.body.data).toHaveLength(3)
  })

  it('each model has id, object, created, owned_by', async () => {
    const res = await request(app).get('/v1/models')
    for (const model of res.body.data) {
      expect(model).toHaveProperty('id')
      expect(model.object).toBe('model')
      expect(model).toHaveProperty('created')
      expect(model).toHaveProperty('owned_by')
    }
  })

  it('owned_by reflects the channel type', async () => {
    const res = await request(app).get('/v1/models')
    const byId = Object.fromEntries(res.body.data.map((m: { id: string }) => [m.id, m]))
    expect(byId['claude-sonnet'].owned_by).toBe('anthropic')
    expect(byId['gpt-4o'].owned_by).toBe('openai')
    expect(byId['llama-70b'].owned_by).toBe('llm-server')
  })
})
