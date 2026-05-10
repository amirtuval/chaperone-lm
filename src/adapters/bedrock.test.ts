import { describe, it, expect } from 'vitest'
import { BedrockAdapter } from './bedrock.js'
import type { GatewayRequest } from './types.js'
import type { ChannelConfig } from '../types.js'

const adapter = new BedrockAdapter()

const channelConfig: ChannelConfig = {
  name: 'bedrock-test',
  type: 'bedrock',
  region: 'us-east-1',
}

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    model: 'anthropic.claude-sonnet-4-5',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as GatewayRequest
}

describe('BedrockAdapter.transformRequest', () => {
  it('passes through a request unchanged', () => {
    const req = makeReq()
    const result = adapter.transformRequest(req)
    expect(result).not.toHaveProperty('writeError')
    expect(result).toMatchObject({ model: 'anthropic.claude-sonnet-4-5' })
  })
})

describe('BedrockAdapter.transformResponse', () => {
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

describe('BedrockAdapter.createModel', () => {
  it('throws if the channel type is not bedrock', () => {
    const wrongConfig: ChannelConfig = { name: 'oai', type: 'openai', apiKey: 'key' }
    expect(() => adapter.createModel(wrongConfig, 'some-model')).toThrow(
      "BedrockAdapter requires channel type 'bedrock'"
    )
  })

  it('returns a model object for a valid bedrock channel config', () => {
    const model = adapter.createModel(channelConfig, 'anthropic.claude-sonnet-4-5')
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })

  it('accepts any bedrock-style model ID', () => {
    const modelIds = [
      'anthropic.claude-sonnet-4-5',
      'amazon.titan-text-express-v1',
      'meta.llama3-70b-instruct-v1:0',
    ]
    for (const id of modelIds) {
      expect(() => adapter.createModel(channelConfig, id)).not.toThrow()
    }
  })
})
