import type { Response } from 'express'
import type { LanguageModelV3StreamPart, LanguageModelV3GenerateResult } from '@ai-sdk/provider'

let idCounter = 0
function generateId(): string {
  return `chatcmpl-${Date.now()}-${++idCounter}`
}

// V3 uses hyphens ('tool-calls', 'content-filter'); OpenAI wire format uses underscores.
function toOpenAIFinishReason(unified: string): string {
  if (unified === 'tool-calls') return 'tool_calls'
  if (unified === 'content-filter') return 'content_filter'
  return unified
}

export async function serializeStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  modelAlias: string,
  res: Response,
  includeUsage = false
): Promise<void> {
  const id = generateId()
  const created = Math.floor(Date.now() / 1000)
  const base = { id, object: 'chat.completion.chunk', created, model: modelAlias }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sse = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    // OpenAI SSE spec: first chunk must establish role
    sse({
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    })

    const toolCallIndexMap = new Map<string, number>()
    let toolCallCounter = 0

    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value: part } = await reader.read()
        if (done) break

        if (part.type === 'text-delta') {
          sse({
            ...base,
            choices: [{ index: 0, delta: { content: part.delta }, finish_reason: null }],
          })
        } else if (part.type === 'reasoning-delta') {
          sse({
            ...base,
            choices: [
              { index: 0, delta: { content: '', reasoning: part.delta }, finish_reason: null },
            ],
          })
        } else if (part.type === 'tool-input-start') {
          const idx = toolCallCounter++
          toolCallIndexMap.set(part.id, idx)
          sse({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: idx,
                      id: part.id,
                      type: 'function',
                      function: { name: part.toolName, arguments: '' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })
        } else if (part.type === 'tool-input-delta') {
          const idx = toolCallIndexMap.get(part.id) ?? 0
          sse({
            ...base,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: idx, function: { arguments: part.delta } }] },
                finish_reason: null,
              },
            ],
          })
        } else if (part.type === 'finish') {
          sse({
            ...base,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: toOpenAIFinishReason(part.finishReason.unified),
              },
            ],
          })
          if (includeUsage) {
            const promptTokens = part.usage?.inputTokens?.total ?? 0
            const completionTokens = part.usage?.outputTokens?.total ?? 0
            sse({
              ...base,
              choices: [],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
              },
            })
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    res.write(
      `data: ${JSON.stringify({ error: { message: err instanceof Error ? err.message : 'Upstream stream error', type: 'server_error' } })}\n\n`
    )
    res.end()
  }
}

export function serializeGenerate(
  result: LanguageModelV3GenerateResult,
  modelAlias: string,
  res: Response
): void {
  const id = generateId()
  const created = Math.floor(Date.now() / 1000)

  let fullText = ''
  const toolCalls: unknown[] = []

  for (const part of result.content) {
    if (part.type === 'text') {
      fullText += part.text
    } else if (part.type === 'tool-call') {
      // V3 input may be a pre-parsed object (e.g. from Anthropic adapter) or already a
      // JSON string (e.g. from OpenAI adapter). OpenAI wire format requires a string.
      const args = typeof part.input === 'string' ? part.input : JSON.stringify(part.input)
      toolCalls.push({
        id: part.toolCallId,
        type: 'function',
        function: { name: part.toolName, arguments: args },
      })
    }
  }

  const message: Record<string, unknown> = { role: 'assistant', content: fullText || null }
  if (toolCalls.length > 0) {
    message['tool_calls'] = toolCalls
    message['content'] = null
  }

  const promptTokens = result.usage.inputTokens.total ?? 0
  const completionTokens = result.usage.outputTokens.total ?? 0

  res.json({
    id,
    object: 'chat.completion',
    created,
    model: modelAlias,
    choices: [
      { index: 0, message, finish_reason: toOpenAIFinishReason(result.finishReason.unified) },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  })
}
