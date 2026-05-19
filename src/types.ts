import type { ProviderAdapter, RouteContext } from './adapters/types.js'

export type ChannelType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'openai-compatible'

// Discriminated union — one variant per ChannelType
export type ChannelConfig =
  | { name: string; type: 'anthropic'; apiKey: string }
  | { name: string; type: 'openai'; apiKey: string }
  | { name: string; type: 'google'; apiKey: string }
  | { name: string; type: 'bedrock'; region: string }
  | {
      name: string
      type: 'vertex'
      project: string
      region: string
      provider?: 'gemini' | 'anthropic' | 'maas'
    }
  | { name: string; type: 'azure'; resourceName: string; apiKey: string }
  | { name: string; type: 'openai-compatible'; baseUrl: string; apiKey?: string }

export interface ModelConfig {
  channel: string
  model: string
  deploymentId?: string
}

export interface AppConfig {
  channels: ChannelConfig[]
  models: Record<string, ModelConfig>
}

export interface ResolvedRoute extends RouteContext {
  adapter: ProviderAdapter
}
