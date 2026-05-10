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
})

const azureChannelSchema = z.object({
  name: z.string(),
  type: z.literal('azure'),
  resourceName: z.string(),
  apiKey: z.string(),
})

const openaiCompatibleChannelSchema = z.object({
  name: z.string(),
  type: z.literal('openai-compatible'),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
})

export const channelSchema = z.discriminatedUnion('type', [
  anthropicChannelSchema,
  openaiChannelSchema,
  googleChannelSchema,
  bedrockChannelSchema,
  vertexChannelSchema,
  azureChannelSchema,
  openaiCompatibleChannelSchema,
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
