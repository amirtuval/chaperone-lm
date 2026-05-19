import type { AppConfig, ResolvedRoute } from '../types.js'
import type { CompletionsProviderAdapter } from '../adapters/types.js'

export function resolveRoute(
  alias: string,
  config: AppConfig,
  completionsRegistry: Map<string, CompletionsProviderAdapter>
): ResolvedRoute | null {
  const modelConfig = config.models[alias]
  if (!modelConfig) return null

  const adapter = completionsRegistry.get(alias)
  if (!adapter) return null

  const channelConfig = config.channels.find((ch) => ch.name === modelConfig.channel)
  if (!channelConfig) return null

  return {
    channelConfig,
    upstreamModelId: modelConfig.model,
    deploymentId: modelConfig.deploymentId,
    adapter,
  }
}
