import { describe, it, expect, vi } from 'vitest'
import { BedrockAdapter } from './bedrock.js'
import type { GatewayRequest } from './types.js'
import type { ChannelConfig } from '../types.js'

// Prevent real AWS credential resolution during unit tests.
// The integration tests cover the real Bedrock API end-to-end.
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: () => (modelId: string) => ({ modelId }),
}))

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
