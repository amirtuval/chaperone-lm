import type { LanguageModel } from 'ai'
import { createVertex } from '@ai-sdk/google-vertex'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'
import { createVertexMaas } from '@ai-sdk/google-vertex/maas'
import type { ChannelConfig } from '../types.js'
import type { AdapterRequestError, GatewayRequest } from './types.js'
import { AISdkAdapter } from './aisdk-base.js'
import { AnthropicAdapter } from './anthropic.js'

// Vertex AI supports three distinct model backends:
//   gemini   (default) — first-party Gemini models via createVertex
//   anthropic          — Claude models via Model Garden (createVertexAnthropic)
//   maas               — third-party models via Model-as-a-Service (createVertexMaas)
//
// The 'provider' field on the channel config selects the backend.
// When omitted, 'gemini' is assumed.
//
// When provider === 'anthropic', request transformation is delegated to
// AnthropicAdapter so that system message merging, reasoning_effort mapping,
// and forced temperature=1 are applied correctly.
//
// The provider is injected at construction time (one adapter instance per
// channel in the registry) so that transformRequest is correct from the very
// first call — independently of whether createModel has run yet.

export class VertexAdapter extends AISdkAdapter {
  private readonly anthropicAdapter = new AnthropicAdapter()
  private readonly provider: 'gemini' | 'anthropic' | 'maas'

  constructor(provider: 'gemini' | 'anthropic' | 'maas' = 'gemini') {
    super()
    this.provider = provider
  }

  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    if (this.provider === 'anthropic') {
      return this.anthropicAdapter.transformRequest(req)
    }
    return req
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
