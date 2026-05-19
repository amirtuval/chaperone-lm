import { z } from 'zod'

const anthropicChannelSchema = z.object({
  name: z.string(),
  type: z.literal('anthropic'),
  apiKey: z.string(),
})

const openaiChannelSchema = z.object({
  name: z.string(),
  type: z.literal('openai'),
  apiKey: z.string(),
})

const googleChannelSchema = z.object({
  name: z.string(),
  type: z.literal('google'),
  apiKey: z.string(),
})

const bedrockChannelSchema = z.object({
  name: z.string(),
  type: z.literal('bedrock'),
  region: z.string(),
})

const vertexChannelSchema = z.object({
  name: z.string(),
  type: z.literal('vertex'),
  project: z.string(),
  region: z.string(),
  provider: z.enum(['gemini', 'anthropic', 'maas']).optional(),
})

const azureChannelSchema = z.object({
  name: z.string(),
  type: z.literal('azure'),
  resourceName: z.string(),
  apiKey: z.string(),
})

const llmServerChannelSchema = z.object({
  name: z.string(),
  type: z.literal('llm-server'),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  protocols: z.array(z.enum(['openai', 'anthropic'])).default(['openai']),
})

export const channelSchema = z.discriminatedUnion('type', [
  anthropicChannelSchema,
  openaiChannelSchema,
  googleChannelSchema,
  bedrockChannelSchema,
  vertexChannelSchema,
  azureChannelSchema,
  llmServerChannelSchema,
])

export const modelConfigSchema = z.object({
  channel: z.string(),
  model: z.string(),
  deploymentId: z.string().optional(),
})

export const appConfigSchema = z.object({
  channels: z.array(channelSchema),
  models: z.record(z.string(), modelConfigSchema),
})
