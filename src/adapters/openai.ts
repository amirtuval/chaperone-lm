import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, AdapterRequestError, GatewayRequest } from './types.js'

export class OpenAIAdapter implements ProviderAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    const transformed = { ...req }

    // Strip non-OpenAI providerOptions
    if (transformed.providerOptions) {
      const { anthropic: _a, google: _g, ...rest } = transformed.providerOptions as Record<string, unknown>
      const openaiOptions = (rest as { openai?: unknown }).openai
      transformed.providerOptions = openaiOptions !== undefined ? { openai: openaiOptions } : {}
    }

    // For o1/o3 models: rewrite max_tokens → providerOptions.openai.maxCompletionTokens, remove temperature
    const modelId = typeof transformed.model === 'string' ? transformed.model : ''
    if (modelId.startsWith('o1') || modelId.startsWith('o3')) {
      if (transformed.max_tokens !== undefined && transformed.max_tokens !== null) {
        transformed.providerOptions = {
          ...(transformed.providerOptions ?? {}),
          openai: {
            ...((transformed.providerOptions as Record<string, unknown> | undefined)?.['openai'] as Record<string, unknown> | undefined ?? {}),
            maxCompletionTokens: transformed.max_tokens,
          },
        }
        delete transformed.max_tokens
      }
      delete transformed.temperature
    }

    return transformed
  }

  async *transformResponse(
    stream: AsyncIterable<LanguageModelV3StreamPart>
  ): AsyncIterable<LanguageModelV3StreamPart> {
    for await (const part of stream) {
      yield part
    }
  }

  createModel(channelConfig: ChannelConfig, modelId: string, _deploymentId?: string): LanguageModel {
    if (channelConfig.type !== 'openai') {
      throw new Error(`OpenAIAdapter requires channel type 'openai', got '${channelConfig.type}'`)
    }
    return createOpenAI({ apiKey: channelConfig.apiKey })(modelId)
  }
}
