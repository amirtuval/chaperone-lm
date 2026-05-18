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

const ADAPTER_MAP: Partial<Record<ChannelType, AdapterConstructor>> = {
  anthropic: AnthropicAdapter,
  openai: OpenAIAdapter,
  google: GoogleAdapter,
  bedrock: BedrockAdapter,
  azure: AzureAdapter,
  'openai-compatible': OpenAICompatibleAdapter,
}

function buildAdapter(ch: ChannelConfig): ProviderAdapter {
  // VertexAdapter requires the provider at construction time so that
  // transformRequest is correct before createModel is ever called.
  if (ch.type === 'vertex') {
    return new VertexAdapter(ch.provider ?? 'gemini')
  }
  const Ctor = ADAPTER_MAP[ch.type]!
  return new Ctor()
}

export function buildAdapterRegistry(channels: ChannelConfig[]): Map<string, ProviderAdapter> {
  return new Map(channels.map((ch) => [ch.name, buildAdapter(ch)] as const))
}
