import type { Request, Response } from 'express'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3ToolChoice,
} from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import { serializeStream, serializeGenerate } from '../pipeline/serialize.js'
import type { ProviderAdapter, RouteContext, GatewayRequest, AdapterRequestError } from './types.js'

function isAdapterError(result: unknown): result is AdapterRequestError {
  return typeof result === 'object' && result !== null && 'writeError' in result
}

function buildPrompt(messages: GatewayRequest['messages']): LanguageModelV3Prompt {
  const systemTexts = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)

  const prompt: LanguageModelV3Prompt = []

  if (systemTexts.length > 0) {
    prompt.push({ role: 'system', content: systemTexts.join('\n\n') })
  }

  for (const m of messages) {
    if (m.role === 'user') {
      prompt.push({
        role: 'user',
        content: [{ type: 'text', text: typeof m.content === 'string' ? m.content : '' }],
      })
    } else if (m.role === 'assistant') {
      prompt.push({
        role: 'assistant',
        content: [{ type: 'text', text: typeof m.content === 'string' ? m.content : '' }],
      })
    }
  }
  return prompt
}

function buildTools(rawTools: GatewayRequest['tools']): LanguageModelV3FunctionTool[] | undefined {
  if (!rawTools || rawTools.length === 0) return undefined
  const tools: LanguageModelV3FunctionTool[] = []
  for (const raw of rawTools) {
    if (raw.type !== 'function') continue
    const fn = raw.function
    tools.push({
      type: 'function',
      name: fn.name,
      description: fn.description ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: (fn.parameters as any) ?? { type: 'object', properties: {} },
    })
  }
  return tools.length > 0 ? tools : undefined
}

function buildToolChoice(
  toolChoice: GatewayRequest['tool_choice']
): LanguageModelV3ToolChoice | undefined {
  if (!toolChoice) return undefined
  if (toolChoice === 'auto') return { type: 'auto' }
  if (toolChoice === 'none') return { type: 'none' }
  if (toolChoice === 'required') return { type: 'required' }
  if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
    return { type: 'tool', toolName: toolChoice.function.name }
  }
  return undefined
}

export abstract class AISdkAdapter implements ProviderAdapter {
  abstract transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError

  abstract createModel(
    channelConfig: ChannelConfig,
    modelId: string,
    deploymentId?: string
  ): LanguageModelV3

  async handleRequest(req: Request, res: Response, ctx: RouteContext): Promise<void> {
    const body = req.body as GatewayRequest
    const alias = typeof body.model === 'string' ? body.model : ''

    const requestWithUpstreamModel: GatewayRequest = { ...body, model: ctx.upstreamModelId }
    const transformed = this.transformRequest(requestWithUpstreamModel)
    if (isAdapterError(transformed)) {
      transformed.writeError(res)
      return
    }

    const model = this.createModel(ctx.channelConfig, ctx.upstreamModelId, ctx.deploymentId)
    const options: LanguageModelV3CallOptions = {
      prompt: buildPrompt(transformed.messages ?? []),
      temperature: transformed.temperature ?? undefined,
      maxOutputTokens: transformed.max_tokens ?? undefined,
      topP: transformed.top_p ?? undefined,
      tools: buildTools(transformed.tools),
      toolChoice: buildToolChoice(transformed.tool_choice),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: transformed.providerOptions as any,
    }

    try {
      if (transformed.stream === true) {
        const { stream } = await model.doStream(options)
        await serializeStream(stream, alias, res)
      } else {
        const result = await model.doGenerate(options)
        serializeGenerate(result, alias, res)
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({
          error: {
            message: err instanceof Error ? err.message : 'Upstream error',
            type: 'server_error',
          },
        })
      }
    }
  }
}
