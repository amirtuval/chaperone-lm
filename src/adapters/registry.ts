import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'
import { createVertexMaas } from '@ai-sdk/google-vertex/maas'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createAzure } from '@ai-sdk/azure'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { AppConfig, ChannelConfig, ModelConfig } from '../types.js'
import type {
  CompletionsProviderAdapter,
  MessagesProviderAdapter,
  AdapterRequestError,
  GatewayRequest,
} from './types.js'
import { AISdkCompletionsAdapter } from './aisdk-completions.js'
import { AISdkMessagesAdapter } from './aisdk-messages.js'
import { OpenAIPassthroughAdapter } from './passthrough-openai.js'
import { AnthropicPassthroughAdapter } from './passthrough-anthropic.js'
import { wrapV2AsV3 } from './v2-compat.js'
import { httpError } from './errors.js'

// ---------------------------------------------------------------------------
// Per-provider transform functions
// ---------------------------------------------------------------------------

const REASONING_EFFORT_BUDGET: Record<string, number> = {
  low: 2000,
  medium: 8000,
  high: 16000,
}

function anthropicTransform(req: GatewayRequest): GatewayRequest | AdapterRequestError {
  const transformed = { ...req }

  // Merge multiple system messages into one
  const systemMessages = transformed.messages.filter((m) => m.role === 'system')
  const nonSystemMessages = transformed.messages.filter((m) => m.role !== 'system')
  if (systemMessages.length > 1) {
    const merged = systemMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n')
    transformed.messages = [{ role: 'system', content: merged }, ...nonSystemMessages]
  }

  // Map reasoning_effort to Anthropic thinking providerOptions
  if (req.reasoning_effort !== undefined) {
    const budget = REASONING_EFFORT_BUDGET[req.reasoning_effort]
    if (budget === undefined) {
      return httpError(400, `Unsupported reasoning_effort value: "${req.reasoning_effort}"`)
    }
    transformed.providerOptions = {
      ...(transformed.providerOptions ?? {}),
      anthropic: {
        ...(((transformed.providerOptions as Record<string, unknown> | undefined)?.['anthropic'] as
          | Record<string, unknown>
          | undefined) ?? {}),
        thinking: { type: 'enabled', budgetTokens: budget },
      },
    }
    // Anthropic requires temperature = 1 when thinking is enabled
    transformed.temperature = 1
  }

  return transformed
}

function openaiStyleTransform(req: GatewayRequest): GatewayRequest | AdapterRequestError {
  const transformed = { ...req }

  // Strip non-OpenAI providerOptions — keep only the openai key
  if (transformed.providerOptions) {
    const opts = transformed.providerOptions as Record<string, unknown>
    const openaiOptions = opts['openai']
    transformed.providerOptions = openaiOptions !== undefined ? { openai: openaiOptions } : {}
  }

  // For o1/o3 models: rewrite max_tokens → providerOptions.openai.maxCompletionTokens, remove temperature
  const modelId = typeof transformed.model === 'string' ? transformed.model : ''
  if (modelId.startsWith('o1') || modelId.startsWith('o3')) {
    if (transformed.max_tokens !== undefined && transformed.max_tokens !== null) {
      transformed.providerOptions = {
        ...(transformed.providerOptions ?? {}),
        openai: {
          ...(((transformed.providerOptions as Record<string, unknown> | undefined)?.['openai'] as
            | Record<string, unknown>
            | undefined) ?? {}),
          maxCompletionTokens: transformed.max_tokens,
        },
      }
      delete transformed.max_tokens
    }
    delete transformed.temperature
  }

  return transformed
}

const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
]

function googleTransform(req: GatewayRequest): GatewayRequest | AdapterRequestError {
  const transformed = { ...req }

  // Extract system messages and move to providerOptions.google.systemInstruction
  const systemMessages = transformed.messages.filter((m) => m.role === 'system')
  if (systemMessages.length > 0) {
    const systemText = systemMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n')
    transformed.messages = transformed.messages.filter((m) => m.role !== 'system')
    const existingGoogle =
      ((transformed.providerOptions as Record<string, unknown> | undefined)?.['google'] as
        | Record<string, unknown>
        | undefined) ?? {}
    transformed.providerOptions = {
      ...(transformed.providerOptions ?? {}),
      google: { ...existingGoogle, systemInstruction: systemText },
    }
  }

  // Apply default safety settings if not present
  const googleOptions =
    ((transformed.providerOptions as Record<string, unknown> | undefined)?.['google'] as
      | Record<string, unknown>
      | undefined) ?? {}
  if (!googleOptions['safetySettings']) {
    transformed.providerOptions = {
      ...(transformed.providerOptions ?? {}),
      google: { ...googleOptions, safetySettings: DEFAULT_SAFETY_SETTINGS },
    }
  }

  return transformed
}

// ---------------------------------------------------------------------------
// Per-channel adapter factory
// ---------------------------------------------------------------------------

function createCompletionsAdapter(
  ch: ChannelConfig,
  modelConfig: ModelConfig
): CompletionsProviderAdapter {
  const { model: modelId, deploymentId } = modelConfig

  switch (ch.type) {
    case 'anthropic':
      return new AISdkCompletionsAdapter(
        createAnthropic({ apiKey: ch.apiKey })(modelId),
        anthropicTransform
      )

    case 'openai':
      return new AISdkCompletionsAdapter(
        createOpenAI({ apiKey: ch.apiKey })(modelId),
        openaiStyleTransform
      )

    case 'google':
      return new AISdkCompletionsAdapter(
        createGoogleGenerativeAI({ apiKey: ch.apiKey })(modelId),
        googleTransform
      )

    case 'bedrock':
      return new AISdkCompletionsAdapter(
        wrapV2AsV3(createAmazonBedrock({ region: ch.region })(modelId))
      )

    case 'vertex': {
      const provider = ch.provider ?? 'gemini'
      let model: LanguageModelV3
      let transformFn: ((req: GatewayRequest) => GatewayRequest | AdapterRequestError) | undefined

      if (provider === 'anthropic') {
        model = createVertexAnthropic({ project: ch.project, location: ch.region })(modelId)
        transformFn = anthropicTransform
      } else if (provider === 'maas') {
        model = createVertexMaas({ project: ch.project, location: ch.region })(modelId)
      } else {
        model = createVertex({ project: ch.project, location: ch.region })(modelId)
      }

      return new AISdkCompletionsAdapter(model, transformFn)
    }

    case 'azure':
      return new AISdkCompletionsAdapter(
        createAzure({ resourceName: ch.resourceName, apiKey: ch.apiKey }).chat(
          deploymentId ?? modelId
        ),
        openaiStyleTransform
      )

    case 'llm-server': {
      const authHeaders: Record<string, string> = ch.apiKey
        ? { Authorization: `Bearer ${ch.apiKey}` }
        : {}
      return new OpenAIPassthroughAdapter(ch.baseUrl, authHeaders)
    }
  }
}

// ---------------------------------------------------------------------------
// Messages adapter factory
// ---------------------------------------------------------------------------

function createMessagesAdapter(
  ch: ChannelConfig,
  modelConfig: ModelConfig
): MessagesProviderAdapter {
  const { model: modelId, deploymentId } = modelConfig

  switch (ch.type) {
    case 'anthropic':
      return new AnthropicPassthroughAdapter('https://api.anthropic.com', {
        'x-api-key': ch.apiKey,
        'anthropic-version': '2023-06-01',
      })

    case 'openai':
      return new AISdkMessagesAdapter(createOpenAI({ apiKey: ch.apiKey })(modelId))

    case 'google':
      return new AISdkMessagesAdapter(createGoogleGenerativeAI({ apiKey: ch.apiKey })(modelId))

    case 'bedrock':
      return new AISdkMessagesAdapter(
        wrapV2AsV3(createAmazonBedrock({ region: ch.region })(modelId))
      )

    case 'vertex': {
      const provider = ch.provider ?? 'gemini'
      if (provider === 'anthropic') {
        return new AISdkMessagesAdapter(
          createVertexAnthropic({ project: ch.project, location: ch.region })(modelId)
        )
      } else if (provider === 'maas') {
        return new AISdkMessagesAdapter(
          createVertexMaas({ project: ch.project, location: ch.region })(modelId)
        )
      } else {
        return new AISdkMessagesAdapter(
          createVertex({ project: ch.project, location: ch.region })(modelId)
        )
      }
    }

    case 'azure':
      return new AISdkMessagesAdapter(
        createAzure({ resourceName: ch.resourceName, apiKey: ch.apiKey }).chat(
          deploymentId ?? modelId
        )
      )

    case 'llm-server': {
      if (ch.protocols.includes('anthropic')) {
        const authHeaders: Record<string, string> = ch.apiKey ? { 'x-api-key': ch.apiKey } : {}
        return new AnthropicPassthroughAdapter(ch.baseUrl, authHeaders)
      }
      const authHeaders: Record<string, string> = ch.apiKey
        ? { Authorization: `Bearer ${ch.apiKey}` }
        : {}
      return new AISdkMessagesAdapter(
        createOpenAICompatible({ name: ch.name, baseURL: ch.baseUrl, headers: authHeaders })(
          modelId
        )
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Public registry builders
// ---------------------------------------------------------------------------

export function buildCompletionsRegistry(
  config: AppConfig
): Map<string, CompletionsProviderAdapter> {
  const registry = new Map<string, CompletionsProviderAdapter>()
  const channelMap = new Map(config.channels.map((ch) => [ch.name, ch]))

  for (const [alias, modelConfig] of Object.entries(config.models)) {
    const ch = channelMap.get(modelConfig.channel)
    if (!ch) continue
    registry.set(alias, createCompletionsAdapter(ch, modelConfig))
  }

  return registry
}

export function buildMessagesRegistry(config: AppConfig): Map<string, MessagesProviderAdapter> {
  const registry = new Map<string, MessagesProviderAdapter>()
  const channelMap = new Map(config.channels.map((ch) => [ch.name, ch]))

  for (const [alias, modelConfig] of Object.entries(config.models)) {
    const ch = channelMap.get(modelConfig.channel)
    if (!ch) continue
    registry.set(alias, createMessagesAdapter(ch, modelConfig))
  }

  return registry
}
