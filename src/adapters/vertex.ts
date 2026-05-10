import type { LanguageModel } from 'ai'
import { createVertex } from '@ai-sdk/google-vertex'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'
import { createVertexMaas } from '@ai-sdk/google-vertex/maas'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, GatewayRequest, AdapterRequestError } from './types.js'

// Vertex AI supports three distinct model backends:
//   gemini   (default) — first-party Gemini models via createVertex
//   anthropic          — Claude models via Model Garden (createVertexAnthropic)
//   maas               — third-party models via Model-as-a-Service (createVertexMaas)
//
// The 'provider' field on the channel config selects the backend.
// When omitted, 'gemini' is assumed.

export class VertexAdapter implements ProviderAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    return req
  }

  async *transformResponse(
    stream: AsyncIterable<LanguageModelV3StreamPart>
  ): AsyncIterable<LanguageModelV3StreamPart> {
    yield* stream
  }

  createModel(channelConfig: ChannelConfig, modelId: string): LanguageModel {
    if (channelConfig.type !== 'vertex') {
      throw new Error(`VertexAdapter: expected vertex channel config, got ${channelConfig.type}`)
    }

    const { project, region, provider = 'gemini' } = channelConfig

    if (provider === 'anthropic') {
      return createVertexAnthropic({ project, location: region })(modelId)
    }

    if (provider === 'maas') {
      return createVertexMaas({ project, location: region })(modelId)
    }

    // gemini (default)
    return createVertex({ project, location: region })(modelId)
  }
}
