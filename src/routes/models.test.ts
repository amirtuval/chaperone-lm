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

const registry = new Map<string, CompletionsProviderAdapter>([
  ['claude-sonnet', makeAdapter()],
  ['gpt-4o', makeAdapter()],
  ['llama-70b', makeAdapter()],
])

const app = createApp(config, registry)

describe('GET /v1/models — OpenAI format (no anthropic-version header)', () => {
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

describe('GET /v1/models — Anthropic format (anthropic-version header)', () => {
  it('returns Anthropic-format model list', async () => {
    const res = await request(app).get('/v1/models').set('anthropic-version', '2023-06-01')
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('object')
    expect(res.body.has_more).toBe(false)
    expect(res.body.data).toHaveLength(3)
  })

  it('each model entry has type, id, display_name', async () => {
    const res = await request(app).get('/v1/models').set('anthropic-version', '2023-06-01')
    for (const model of res.body.data) {
      expect(model.type).toBe('model')
      expect(typeof model.id).toBe('string')
      expect(typeof model.display_name).toBe('string')
    }
  })

  it('first_id and last_id match first and last alias', async () => {
    const res = await request(app).get('/v1/models').set('anthropic-version', '2023-06-01')
    const ids: string[] = res.body.data.map((m: { id: string }) => m.id)
    expect(res.body.first_id).toBe(ids[0])
    expect(res.body.last_id).toBe(ids[ids.length - 1])
  })

  it('does not include owned_by or object fields', async () => {
    const res = await request(app).get('/v1/models').set('anthropic-version', '2023-06-01')
    for (const model of res.body.data) {
      expect(model).not.toHaveProperty('object')
      expect(model).not.toHaveProperty('owned_by')
    }
  })
})
