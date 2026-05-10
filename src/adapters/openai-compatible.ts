import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, AdapterRequestError, GatewayRequest } from './types.js'

export class OpenAICompatibleAdapter implements ProviderAdapter {
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
    if (channelConfig.type !== 'openai-compatible') {
      throw new Error(
        `OpenAICompatibleAdapter requires channel type 'openai-compatible', got '${channelConfig.type}'`
      )
    }
    const provider = createOpenAICompatible({
      name: channelConfig.baseUrl,
      baseURL: channelConfig.baseUrl,
      apiKey: channelConfig.apiKey,
    })
    return provider(modelId)
  }
}
