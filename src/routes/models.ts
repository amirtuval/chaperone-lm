import type { Request, Response } from 'express'
import type { AppConfig } from '../types.js'
import type { CompletionsProviderAdapter } from '../adapters/types.js'

export function makeModelsHandler(
  config: AppConfig,
  _completionsRegistry: Map<string, CompletionsProviderAdapter>
) {
  return (req: Request, res: Response) => {
    const isAnthropicClient = Boolean(req.headers['anthropic-version'])

    if (isAnthropicClient) {
      const data = Object.entries(config.models).map(([alias]) => {
        const id = alias.startsWith('claude-') ? alias : `claude-${alias}`
        return {
          type: 'model',
          id,
          display_name: alias,
          created_at: new Date(0).toISOString(),
        }
      })
      const ids = data.map((m) => m.id)
      res.json({
        data,
        has_more: false,
        first_id: ids[0] ?? null,
        last_id: ids[ids.length - 1] ?? null,
      })
    } else {
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
}
