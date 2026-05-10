import type { Response } from 'express'
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import type { ChannelConfig } from '../types.js'

// Extends the standard OpenAI type with gateway-specific fields that adapters
// need to read or write (providerOptions, reasoning_effort). These are non-standard
// but widely used by clients targeting this gateway.
export type GatewayRequest = ChatCompletionCreateParams & {
  providerOptions?: Record<string, unknown>
  reasoning_effort?: 'low' | 'medium' | 'high'
}

export interface AdapterRequestError {
  writeError(res: Response): void
}

export interface ProviderAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError
  transformResponse(stream: AsyncIterable<LanguageModelV3StreamPart>): AsyncIterable<LanguageModelV3StreamPart>
  createModel(channelConfig: ChannelConfig, modelId: string, deploymentId?: string): LanguageModel
}
