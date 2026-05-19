import { describe } from 'vitest'
import { createApp } from '../../server.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from '../registry.js'
import type { AppConfig } from '../../types.js'
import { runMessagesProviderSuite } from './helpers/messagesProviderSuite.js'

// AWS Bedrock — via AISdkMessagesAdapter.
// Authenticates via AWS environment credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, etc.)
// Required env vars:
//   AWS_REGION or BEDROCK_REGION (defaults to us-east-1)

const BEDROCK_REGION = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1'
// Use AWS_ACCESS_KEY_ID as the presence check (standard AWS SDK env var)
const hasCredentials = Boolean(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE)

function makeApp(modelAlias: string, modelId: string) {
  const config: AppConfig = {
    channels: [{ name: 'bedrock-test', type: 'bedrock', region: BEDROCK_REGION }],
    models: { [modelAlias]: { channel: 'bedrock-test', model: modelId } },
  }
  return createApp(config, buildCompletionsRegistry(config), buildMessagesRegistry(config))
}

describe.skipIf(!hasCredentials)('Bedrock Messages API — Claude Sonnet 4.6 — integration', () => {
  runMessagesProviderSuite({
    app: makeApp('claude-sonnet', 'us.anthropic.claude-sonnet-4-6'),
    modelAlias: 'claude-sonnet',
    strictFinishReason: true,
  })
})
