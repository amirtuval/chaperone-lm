import type { Request, Response } from 'express'
import type { AppConfig } from '../types.js'
import type { ProviderAdapter } from '../adapters/types.js'

export function makeModelsHandler(
  config: AppConfig,
  _adapterRegistry: Map<string, ProviderAdapter>
) {
  return (_req: Request, res: Response) => {
    const data = Object.entries(config.models).map(([alias, modelConfig]) => {
      const channel = config.channels.find((ch) => ch.name === modelConfig.channel)
      return {
        id: alias,
        object: 'model',
        created: 0,
        owned_by: channel?.type ?? 'unknown',
      }
    })

    res.json({ object: 'list', data })
  }
}
