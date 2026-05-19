import type { LanguageModel } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import type { ChannelConfig } from '../types.js'
import type { AdapterRequestError, GatewayRequest } from './types.js'
import { AISdkAdapter } from './aisdk-base.js'

const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
]

export class GoogleAdapter extends AISdkAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
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
        google: {
          ...existingGoogle,
          systemInstruction: systemText,
        },
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
        google: {
          ...googleOptions,
          safetySettings: DEFAULT_SAFETY_SETTINGS,
        },
      }
    }

    return transformed
  }

  createModel(
    channelConfig: ChannelConfig,
    modelId: string,
    _deploymentId?: string
  ): LanguageModel {
    switch (channelConfig.type) {
      case 'google':
        return createGoogleGenerativeAI({ apiKey: channelConfig.apiKey })(modelId)
      case 'vertex':
        return createVertex({ project: channelConfig.project, location: channelConfig.region })(
          modelId
        )
      default:
        throw new Error(
          `GoogleAdapter does not support channel type: ${(channelConfig as ChannelConfig).type}`
        )
    }
  }
}
