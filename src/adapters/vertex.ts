import type { LanguageModel } from 'ai'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, GatewayRequest, AdapterRequestError } from './types.js'

// Vertex AI Model Garden: Claude models are accessed via the @ai-sdk/google-vertex
// package's Anthropic subpath, which handles ADC auth and the Vertex endpoint URL
// internally. No manual token fetching or URL rewriting required.

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

    const { project, region } = channelConfig

    const provider = createVertexAnthropic({ project, location: region })
    return provider(modelId)
  }
}
