import type { LanguageModel } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, AdapterRequestError, GatewayRequest } from './types.js'

export class BedrockAdapter implements ProviderAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    return req
  }

  async *transformResponse(
    stream: AsyncIterable<LanguageModelV3StreamPart>
  ): AsyncIterable<LanguageModelV3StreamPart> {
    for await (const part of stream) {
      yield part
    }
  }

  createModel(
    channelConfig: ChannelConfig,
    modelId: string,
    _deploymentId?: string
  ): LanguageModel {
    if (channelConfig.type !== 'bedrock') {
      throw new Error(`BedrockAdapter requires channel type 'bedrock', got '${channelConfig.type}'`)
    }
    return createAmazonBedrock({ region: channelConfig.region })(modelId)
  }
}
