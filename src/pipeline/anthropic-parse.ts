import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3TextPart,
  LanguageModelV3FilePart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3ToolChoice,
} from '@ai-sdk/provider'

// ---------------------------------------------------------------------------
// Anthropic Messages API request types (subset)
// ---------------------------------------------------------------------------

export interface AnthropicTextBlock {
  type: 'text'
  text: string
}

export interface AnthropicImageBlock {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }
}

export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | AnthropicTextBlock[]
  is_error?: boolean
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string }

export interface AnthropicMessagesRequest {
  model: string
  system?: string | AnthropicTextBlock[]
  messages: AnthropicMessage[]
  max_tokens: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: AnthropicTool[]
  tool_choice?: AnthropicToolChoice
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseSystemPrompt(system: AnthropicMessagesRequest['system']): string | undefined {
  if (!system) return undefined
  if (typeof system === 'string') return system
  return system
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
}

function parseContentBlocks(
  content: string | AnthropicContentBlock[]
): Array<
  | LanguageModelV3TextPart
  | LanguageModelV3FilePart
  | LanguageModelV3ToolCallPart
  | LanguageModelV3ToolResultPart
> {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  const parts: Array<
    | LanguageModelV3TextPart
    | LanguageModelV3FilePart
    | LanguageModelV3ToolCallPart
    | LanguageModelV3ToolResultPart
  > = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      if (block.source.type === 'base64') {
        parts.push({
          type: 'file',
          data: block.source.data,
          mediaType: block.source.media_type,
        })
      } else {
        parts.push({ type: 'file', data: new URL(block.source.url), mediaType: 'image/*' })
      }
    } else if (block.type === 'tool_use') {
      parts.push({
        type: 'tool-call',
        toolCallId: block.id,
        toolName: block.name,
        input: block.input,
      })
    } else if (block.type === 'tool_result') {
      const value =
        typeof block.content === 'string'
          ? block.content
          : block.content
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
      parts.push({
        type: 'tool-result',
        toolCallId: block.tool_use_id,
        toolName: 'unknown',
        output: { type: 'text', value },
      })
    }
  }
  return parts
}

function parseToolChoice(
  tc: AnthropicToolChoice | undefined
): LanguageModelV3ToolChoice | undefined {
  if (!tc) return undefined
  if (tc.type === 'auto') return { type: 'auto' }
  if (tc.type === 'any') return { type: 'required' }
  if (tc.type === 'none') return { type: 'none' }
  if (tc.type === 'tool') return { type: 'tool', toolName: tc.name }
  return undefined
}

export function parseAnthropicRequest(body: AnthropicMessagesRequest): LanguageModelV3CallOptions {
  const systemText = parseSystemPrompt(body.system)
  const prompt: LanguageModelV3Prompt = []

  if (systemText) {
    prompt.push({ role: 'system', content: systemText })
  }

  // Pre-pass: build tool_use id → name map for tool_result blocks
  const toolUseNames = new Map<string, string>()
  for (const msg of body.messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content as AnthropicContentBlock[]) {
        if (block.type === 'tool_use') {
          toolUseNames.set(block.id, block.name)
        }
      }
    }
  }

  for (const msg of body.messages) {
    const rawParts = parseContentBlocks(msg.content as string | AnthropicContentBlock[])

    // Patch tool-result toolName from pre-pass map
    const parts = rawParts.map((p) => {
      if (p.type === 'tool-result') {
        return { ...p, toolName: toolUseNames.get(p.toolCallId) ?? 'unknown' }
      }
      return p
    })

    if (msg.role === 'user') {
      const userParts = parts.filter(
        (p) => p.type === 'text' || p.type === 'file' || p.type === 'tool-result'
      )
      if (userParts.length > 0) {
        // tool-result parts go in a separate tool role message
        const textImageParts = userParts.filter(
          (p): p is LanguageModelV3TextPart | LanguageModelV3FilePart =>
            p.type === 'text' || p.type === 'file'
        )
        const toolResultParts = userParts.filter(
          (p): p is LanguageModelV3ToolResultPart => p.type === 'tool-result'
        )
        if (textImageParts.length > 0) {
          prompt.push({ role: 'user', content: textImageParts })
        }
        for (const trp of toolResultParts) {
          prompt.push({ role: 'tool', content: [trp] })
        }
      }
    } else if (msg.role === 'assistant') {
      const assistantParts = parts.filter(
        (p): p is LanguageModelV3TextPart | LanguageModelV3ToolCallPart =>
          p.type === 'text' || p.type === 'tool-call'
      )
      if (assistantParts.length > 0) {
        prompt.push({ role: 'assistant', content: assistantParts })
      }
    }
  }

  const tools: LanguageModelV3FunctionTool[] | undefined = body.tools?.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  }))

  return {
    prompt,
    maxOutputTokens: body.max_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    tools: tools && tools.length > 0 ? tools : undefined,
    toolChoice: parseToolChoice(body.tool_choice),
  }
}
