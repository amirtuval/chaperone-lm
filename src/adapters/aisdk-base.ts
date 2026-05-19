import type { Request, Response } from 'express'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3ToolChoice,
} from '@ai-sdk/provider'
import type { ChannelConfig } from '../types.js'
import { serializeStream, serializeGenerate } from '../pipeline/serialize.js'
import type { ProviderAdapter, RouteContext, GatewayRequest, AdapterRequestError } from './types.js'

function isAdapterError(result: unknown): result is AdapterRequestError {
  return typeof result === 'object' && result !== null && 'writeError' in result
}

export function buildPrompt(messages: GatewayRequest['messages']): LanguageModelV3Prompt {
  const systemTexts = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)

  // Pre-pass: collect tool call id → name so tool result messages can include toolName
  const toolCallNames = new Map<string, string>()
  for (const m of messages) {
    if (m.role === 'assistant') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls = (m as any).tool_calls as
        | Array<{ id: string; function: { name: string } }>
        | undefined
      toolCalls?.forEach((tc) => toolCallNames.set(tc.id, tc.function.name))
    }
  }

  const prompt: LanguageModelV3Prompt = []

  if (systemTexts.length > 0) {
    prompt.push({ role: 'system', content: systemTexts.join('\n\n') })
  }

  for (const m of messages) {
    if (m.role === 'user') {
      const parts: LanguageModelV3TextPart[] = []
      if (typeof m.content === 'string') {
        if (m.content) parts.push({ type: 'text', text: m.content })
      } else if (Array.isArray(m.content)) {
        for (const p of m.content as Array<{ type: string; text?: string }>) {
          if (p.type === 'text' && p.text) parts.push({ type: 'text', text: p.text })
        }
      }
      if (parts.length > 0) prompt.push({ role: 'user', content: parts })
    } else if (m.role === 'assistant') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const am = m as any
      const parts: Array<LanguageModelV3TextPart | LanguageModelV3ToolCallPart> = []

      if (typeof am.content === 'string' && am.content) {
        parts.push({ type: 'text', text: am.content })
      }

      const toolCalls = am.tool_calls as
        | Array<{ id: string; function: { name: string; arguments: string } }>
        | undefined
      toolCalls?.forEach((tc) =>
        parts.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments,
        })
      )

      if (parts.length > 0) prompt.push({ role: 'assistant', content: parts })
    } else if (m.role === 'tool') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tm = m as any
      const value = typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content)
      const part: LanguageModelV3ToolResultPart = {
        type: 'tool-result',
        toolCallId: tm.tool_call_id,
        toolName: toolCallNames.get(tm.tool_call_id) ?? 'unknown',
        output: { type: 'text', value },
      }
      prompt.push({ role: 'tool', content: [part] })
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
