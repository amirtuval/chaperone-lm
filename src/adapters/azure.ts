import type { LanguageModel } from 'ai'
import { createAzure } from '@ai-sdk/azure'
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, AdapterRequestError, GatewayRequest } from './types.js'

export class AzureAdapter implements ProviderAdapter {
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

  createModel(channelConfig: ChannelConfig, modelId: string, deploymentId?: string): LanguageModel {
    if (channelConfig.type !== 'azure') {
      throw new Error(`AzureAdapter requires channel type 'azure', got '${channelConfig.type}'`)
    }
    return createAzure({ resourceName: channelConfig.resourceName, apiKey: channelConfig.apiKey })(
      deploymentId ?? modelId
    )
  }
}
