/**
 * Integration tests for GET /v1/models.
 *
 * Starts a local chaperone server with a fixed config and validates both
 * response formats. No provider credentials required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'

const config: AppConfig = {
  channels: [
    { name: 'ant', type: 'anthropic', apiKey: 'local' },
    { name: 'oai', type: 'openai', apiKey: 'local' },
  ],
  models: {
    'claude-sonnet': { channel: 'ant', model: 'claude-sonnet-4-5' },
    'gpt-4o': { channel: 'oai', model: 'gpt-4o' },
  },
}

let baseURL: string
let stopServer: () => void

beforeAll(async () => {
  const app = createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseURL = `http://127.0.0.1:${addr.port}`
  stopServer = () => server.close()
})

afterAll(() => stopServer())

describe('GET /v1/models — OpenAI format', () => {
  it('returns object:list with all model aliases', async () => {
    const res = await fetch(`${baseURL}/v1/models`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { object: string; data: unknown[] }
    expect(body.object).toBe('list')
    expect(body.data).toHaveLength(2)
  })

  it('each entry has id, object:model, owned_by', async () => {
    const res = await fetch(`${baseURL}/v1/models`)
    const body = (await res.json()) as {
      data: Array<{ id: string; object: string; owned_by: string }>
    }
    for (const entry of body.data) {
      expect(typeof entry.id).toBe('string')
      expect(entry.object).toBe('model')
      expect(typeof entry.owned_by).toBe('string')
    }
  })
})

describe('GET /v1/models — Anthropic format', () => {
  it('returns Anthropic list with has_more, first_id, last_id', async () => {
    const res = await fetch(`${baseURL}/v1/models`, {
      headers: { 'anthropic-version': '2023-06-01' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<{ type: string; id: string; display_name: string }>
      has_more: boolean
      first_id: string
      last_id: string
    }
    expect(body.has_more).toBe(false)
    expect(typeof body.first_id).toBe('string')
    expect(typeof body.last_id).toBe('string')
    expect(body.data).toHaveLength(2)
  })

  it('each entry has type:model, id, display_name', async () => {
    const res = await fetch(`${baseURL}/v1/models`, {
      headers: { 'anthropic-version': '2023-06-01' },
    })
    const body = (await res.json()) as {
      data: Array<{ type: string; id: string; display_name: string }>
    }
    for (const entry of body.data) {
      expect(entry.type).toBe('model')
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.display_name).toBe('string')
    }
  })

  it('first_id is first alias, last_id is last alias', async () => {
    const res = await fetch(`${baseURL}/v1/models`, {
      headers: { 'anthropic-version': '2023-06-01' },
    })
    const body = (await res.json()) as {
      data: Array<{ id: string }>
      first_id: string
      last_id: string
    }
    const ids = body.data.map((m) => m.id)
    expect(body.first_id).toBe(ids[0])
    expect(body.last_id).toBe(ids[ids.length - 1])
  })
})
