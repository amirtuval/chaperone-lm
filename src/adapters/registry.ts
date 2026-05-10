import type { ChannelConfig, ChannelType } from '../types.js'
import type { ProviderAdapter } from './types.js'
import { AnthropicAdapter } from './anthropic.js'
import { OpenAIAdapter } from './openai.js'
import { GoogleAdapter } from './google.js'
import { BedrockAdapter } from './bedrock.js'
import { AzureAdapter } from './azure.js'
import { VertexAdapter } from './vertex.js'
import { OpenAICompatibleAdapter } from './openai-compatible.js'

type AdapterConstructor = new () => ProviderAdapter

const ADAPTER_MAP: Record<ChannelType, AdapterConstructor> = {
  anthropic: AnthropicAdapter,
  openai: OpenAIAdapter,
  google: GoogleAdapter,
  bedrock: BedrockAdapter,
  vertex: VertexAdapter,
  azure: AzureAdapter,
  'openai-compatible': OpenAICompatibleAdapter,
}

export function buildAdapterRegistry(channels: ChannelConfig[]): Map<string, ProviderAdapter> {
  return new Map(channels.map((ch) => [ch.name, new ADAPTER_MAP[ch.type]()] as const))
}
