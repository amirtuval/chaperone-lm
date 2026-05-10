import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createVertex } from '@ai-sdk/google-vertex'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import type { ProviderAdapter, AdapterRequestError, GatewayRequest } from './types.js'
import { httpError } from './errors.js'

const REASONING_EFFORT_BUDGET: Record<string, number> = {
  low: 2000,
  medium: 8000,
  high: 16000,
}

export class AnthropicAdapter implements ProviderAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    const transformed = { ...req }

    // Merge multiple system messages into one
    const systemMessages = transformed.messages.filter((m) => m.role === 'system')
    const nonSystemMessages = transformed.messages.filter((m) => m.role !== 'system')

    if (systemMessages.length > 1) {
      const merged = systemMessages
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n\n')
      transformed.messages = [{ role: 'system', content: merged }, ...nonSystemMessages]
    }

    // Map reasoning_effort to Anthropic thinking providerOptions
    const params = req as GatewayRequest & { reasoning_effort?: string }
    if (params.reasoning_effort !== undefined) {
      const budget = REASONING_EFFORT_BUDGET[params.reasoning_effort]
      if (budget === undefined) {
        return httpError(400, `Unsupported reasoning_effort value: "${params.reasoning_effort}"`)
      }

      transformed.providerOptions = {
        ...(transformed.providerOptions ?? {}),
        anthropic: {
          ...(((transformed.providerOptions as Record<string, unknown> | undefined)?.[
            'anthropic'
          ] as Record<string, unknown> | undefined) ?? {}),
          thinking: { type: 'enabled', budgetTokens: budget },
        },
      }

      // Anthropic requires temperature = 1 when thinking is enabled
      transformed.temperature = 1
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

  createModel(
    channelConfig: ChannelConfig,
    modelId: string,
    _deploymentId?: string
  ): LanguageModel {
    switch (channelConfig.type) {
      case 'anthropic':
        return createAnthropic({ apiKey: channelConfig.apiKey })(modelId)
      case 'bedrock':
        return createAmazonBedrock({ region: channelConfig.region })(modelId)
      case 'vertex':
        return createVertex({ project: channelConfig.project, location: channelConfig.region })(
          modelId
        )
      default:
        throw new Error(
          `AnthropicAdapter does not support channel type: ${(channelConfig as ChannelConfig).type}`
        )
    }
  }
}
