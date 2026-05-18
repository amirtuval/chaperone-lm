import type { ChannelConfig } from '../types.js'
import { PassthroughAdapter } from './passthrough-base.js'

export class OpenAICompatibleAdapter extends PassthroughAdapter {
  getBaseUrl(channelConfig: ChannelConfig): string {
    if (channelConfig.type !== 'openai-compatible') {
      throw new Error(
        `OpenAICompatibleAdapter requires channel type 'openai-compatible', got '${channelConfig.type}'`
      )
    }
    return channelConfig.baseUrl
  }

  getAuthHeaders(channelConfig: ChannelConfig): Record<string, string> {
    if (channelConfig.type !== 'openai-compatible') {
      throw new Error(
        `OpenAICompatibleAdapter requires channel type 'openai-compatible', got '${channelConfig.type}'`
      )
    }
    return channelConfig.apiKey ? { Authorization: `Bearer ${channelConfig.apiKey}` } : {}
  }
}
