import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runMessagesProviderSuite } from './helpers/messagesProviderSuite.js'

// Azure OpenAI — via AISdkMessagesAdapter.
// Required env vars:
//   AZURE_OPENAI_RESOURCE_NAME   — e.g. "chaperone-lm-aoai"
//   AZURE_OPENAI_API_KEY         — Azure OpenAI key

const RESOURCE_NAME = process.env.AZURE_OPENAI_RESOURCE_NAME
const AOAI_KEY = process.env.AZURE_OPENAI_API_KEY
const GPT4O_DEPLOYMENT = process.env.AZURE_OPENAI_GPT4O_DEPLOYMENT ?? 'gpt-4o'

const hasCredentials = Boolean(RESOURCE_NAME && AOAI_KEY)

function makeApp(modelAlias: string, deploymentId: string) {
  const config: AppConfig = {
    channels: [
      { name: 'azure-test', type: 'azure', resourceName: RESOURCE_NAME!, apiKey: AOAI_KEY! },
    ],
    models: { [modelAlias]: { channel: 'azure-test', model: modelAlias, deploymentId } },
  }
  return createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
}

describe.skipIf(!hasCredentials)('Azure OpenAI Messages API — gpt-4o — integration', () => {
  runMessagesProviderSuite({
    app: makeApp('gpt-4o', GPT4O_DEPLOYMENT),
    modelAlias: 'gpt-4o',
    strictFinishReason: true,
  })
})
