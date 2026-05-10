import type { AppConfig, ResolvedRoute } from '../types.js'
import type { ProviderAdapter } from '../adapters/types.js'

export function resolveRoute(
  alias: string,
  config: AppConfig,
  adapterRegistry: Map<string, ProviderAdapter>
): ResolvedRoute | null {
  const modelConfig = config.models[alias]
  if (!modelConfig) return null

  const channelConfig = config.channels.find((ch) => ch.name === modelConfig.channel)
  if (!channelConfig) return null

  const adapter = adapterRegistry.get(modelConfig.channel)
  if (!adapter) return null

  return {
    channelConfig,
    upstreamModelId: modelConfig.model,
    deploymentId: modelConfig.deploymentId,
    adapter,
  }
}
