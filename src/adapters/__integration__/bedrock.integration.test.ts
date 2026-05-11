import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildAdapterRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runProviderSuite } from './helpers/providerSuite.js'

const baseChannel = {
  name: 'bedrock-test',
  type: 'bedrock' as const,
  region: 'us-east-1',
}

function makeApp(modelAlias: string, modelId: string) {
  const config: AppConfig = {
    channels: [baseChannel],
    models: { [modelAlias]: { channel: 'bedrock-test', model: modelId } },
  }
  const registry = buildAdapterRegistry(config.channels)
  return createApp(config, registry)
}

describe('Bedrock — Claude Opus 4.7 — integration', () => {
  runProviderSuite({
    app: makeApp('opus-4-7', 'us.anthropic.claude-opus-4-7'),
    modelAlias: 'opus-4-7',
    strictFinishReason: true,
  })
})

describe('Bedrock — Claude Sonnet 4.6 — integration', () => {
  runProviderSuite({
    app: makeApp('sonnet-4-6', 'us.anthropic.claude-sonnet-4-6'),
    modelAlias: 'sonnet-4-6',
    strictFinishReason: true,
  })
})

describe('Bedrock — Llama 4 Maverick — integration', () => {
  runProviderSuite({
    app: makeApp('llama4-maverick', 'us.meta.llama4-maverick-17b-instruct-v1:0'),
    modelAlias: 'llama4-maverick',
    strictFinishReason: false,
    // Llama models on Bedrock do not support tool use via ConverseStream (the API path
    // the AI SDK always uses), even though the non-streaming Converse API accepts them.
    supportsTools: false,
  })
})
