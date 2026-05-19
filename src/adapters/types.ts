import type { Request, Response } from 'express'
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions'
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

export interface RouteContext {
  channelConfig: ChannelConfig
  upstreamModelId: string
  deploymentId?: string
}

export interface ProviderAdapter {
  handleRequest(req: Request, res: Response, ctx: RouteContext): Promise<void>
}
