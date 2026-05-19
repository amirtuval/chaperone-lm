import type { Response } from 'express'
import type { LanguageModelV3StreamPart, LanguageModelV3GenerateResult } from '@ai-sdk/provider'

let idCounter = 0
function generateId(): string {
  return `msg_${Date.now()}_${++idCounter}`
}

function toAnthropicStopReason(
  unified: string
): 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' {
  if (unified === 'tool-calls') return 'tool_use'
  if (unified === 'length') return 'max_tokens'
  if (unified === 'stop_sequence') return 'stop_sequence'
  return 'end_turn'
}

export async function serializeAnthropicStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  modelAlias: string,
  res: Response
): Promise<void> {
  const id = generateId()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sse = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    sse('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: modelAlias,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })

    let blockIndex = 0
    // Track open content blocks: index → type ('text' | 'tool_use')
    const openBlocks = new Map<number, { type: string; toolCallId?: string }>()
    // Track tool call index → block index
    const toolCallBlocks = new Map<string, number>()

    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value: part } = await reader.read()
        if (done) break

        if (part.type === 'text-delta') {
          // Open a text block if none is open
          if (![...openBlocks.values()].some((b) => b.type === 'text')) {
            sse('content_block_start', {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'text', text: '' },
            })
            openBlocks.set(blockIndex, { type: 'text' })
            blockIndex++
          }
          const textIdx = [...openBlocks.entries()].find(([, b]) => b.type === 'text')?.[0] ?? 0
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: textIdx,
            delta: { type: 'text_delta', text: part.delta },
          })
        } else if (part.type === 'tool-input-start') {
          // Close any open text block first
          for (const [idx, block] of openBlocks) {
            if (block.type === 'text') {
              sse('content_block_stop', { type: 'content_block_stop', index: idx })
              openBlocks.delete(idx)
            }
          }
          sse('content_block_start', {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'tool_use', id: part.id, name: part.toolName, input: {} },
          })
          openBlocks.set(blockIndex, { type: 'tool_use', toolCallId: part.id })
          toolCallBlocks.set(part.id, blockIndex)
          blockIndex++
        } else if (part.type === 'tool-input-delta') {
          const idx = toolCallBlocks.get(part.id) ?? 0
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: idx,
            delta: { type: 'input_json_delta', partial_json: part.delta },
          })
        } else if (part.type === 'finish') {
          // Close all open blocks
          for (const [idx] of openBlocks) {
            sse('content_block_stop', { type: 'content_block_stop', index: idx })
          }
          openBlocks.clear()

          const outputTokens = part.usage?.outputTokens?.total ?? 0
          sse('message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: toAnthropicStopReason(part.finishReason.unified),
              stop_sequence: null,
            },
            usage: { output_tokens: outputTokens },
          })
          sse('message_stop', { type: 'message_stop' })
        }
      }
    } finally {
      reader.releaseLock()
    }

    res.end()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upstream stream error'
    res.write(
      `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: msg } })}\n\n`
    )
    res.end()
  }
}

export function serializeAnthropicGenerate(
  result: LanguageModelV3GenerateResult,
  modelAlias: string,
  res: Response
): void {
  const id = generateId()

  const content: unknown[] = []

  let hasText = false
  let textContent = ''

  for (const part of result.content) {
    if (part.type === 'text') {
      textContent += part.text
      hasText = true
    } else if (part.type === 'tool-call') {
      if (hasText && textContent) {
        content.push({ type: 'text', text: textContent })
        textContent = ''
        hasText = false
      }
      const inputStr =
        typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {})
      content.push({
        type: 'tool_use',
        id: part.toolCallId,
        name: part.toolName,
        input: JSON.parse(inputStr),
      })
    }
  }
  if (hasText && textContent) {
    content.push({ type: 'text', text: textContent })
  }

  const inputTokens = result.usage.inputTokens.total ?? 0
  const outputTokens = result.usage.outputTokens.total ?? 0

  res.json({
    id,
    type: 'message',
    role: 'assistant',
    model: modelAlias,
    content,
    stop_reason: toAnthropicStopReason(result.finishReason.unified),
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  })
}
