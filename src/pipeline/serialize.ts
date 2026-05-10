import type { Response } from 'express'
import type { StreamTextResult, TextStreamPart } from 'ai'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTools = Record<string, any>

let idCounter = 0
function generateId(): string {
  return `chatcmpl-${Date.now()}-${++idCounter}`
}

export async function serializeResponse(
  result: StreamTextResult<AnyTools, never>,
  modelAlias: string,
  stream: boolean,
  res: Response
): Promise<void> {
  const id = generateId()
  const created = Math.floor(Date.now() / 1000)

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      // Track active tool calls by index for streaming deltas
      const toolCallIndexMap = new Map<string, number>()
      let toolCallCounter = 0

      for await (const part of result.fullStream) {
        const chunk = buildChunk(id, created, modelAlias, part, toolCallIndexMap, toolCallCounter)
        if (chunk !== null) {
          if ('_toolCallCounterIncrement' in chunk) {
            toolCallCounter++
          }
          res.write(`data: ${JSON.stringify(chunk.data)}\n\n`)
        }

        if (part.type === 'finish') {
          const finishChunk = {
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelAlias,
            choices: [{ index: 0, delta: {}, finish_reason: part.finishReason ?? 'stop' }],
          }
          res.write(`data: ${JSON.stringify(finishChunk)}\n\n`)
        }
      }

      res.write('data: [DONE]\n\n')
      res.end()
    } catch (err) {
      const errorEvent = {
        error: {
          message: err instanceof Error ? err.message : 'Upstream stream error',
          type: 'server_error',
        },
      }
      res.write(`data: ${JSON.stringify(errorEvent)}\n\n`)
      res.end()
    }
  } else {
    try {
      let fullText = ''
      let finishReason = 'stop'
      let promptTokens = 0
      let completionTokens = 0
      const toolCalls: unknown[] = []

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          fullText += part.text
        } else if (part.type === 'tool-call') {
          toolCalls.push({
            id: part.toolCallId,
            type: 'function',
            function: {
              name: part.toolName,
              arguments: JSON.stringify(part.input),
            },
          })
        } else if (part.type === 'finish') {
          finishReason = part.finishReason ?? 'stop'
          promptTokens = part.totalUsage?.inputTokens ?? 0
          completionTokens = part.totalUsage?.outputTokens ?? 0
        }
      }

      const message: Record<string, unknown> = {
        role: 'assistant',
        content: fullText || null,
      }
      if (toolCalls.length > 0) {
        message['tool_calls'] = toolCalls
        message['content'] = null
      }

      res.json({
        id,
        object: 'chat.completion',
        created,
        model: modelAlias,
        choices: [
          {
            index: 0,
            message,
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      })
    } catch (err) {
      res.status(502).json({
        error: {
          message: err instanceof Error ? err.message : 'Upstream error',
          type: 'server_error',
        },
      })
    }
  }
}

interface ChunkResult {
  data: unknown
  _toolCallCounterIncrement?: true
}

function buildChunk(
  id: string,
  created: number,
  model: string,
  part: TextStreamPart<AnyTools>,
  toolCallIndexMap: Map<string, number>,
  toolCallCounter: number
): ChunkResult | null {
  const base = { id, object: 'chat.completion.chunk', created, model }

  if (part.type === 'text-delta') {
    return {
      data: {
        ...base,
        choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }],
      },
    }
  }

  // reasoning-delta carries a non-standard 'reasoning' extension field
  if (part.type === 'reasoning-delta') {
    return {
      data: {
        ...base,
        choices: [{ index: 0, delta: { content: '', reasoning: part.text }, finish_reason: null }],
      },
    }
  }

  // tool-input-start: first chunk for a tool call — emits id, type, name
  if (part.type === 'tool-input-start') {
    const idx = toolCallCounter
    toolCallIndexMap.set(part.id, idx)
    return {
      data: {
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
      },
      _toolCallCounterIncrement: true,
    }
  }

  // tool-input-delta: subsequent argument fragments
  if (part.type === 'tool-input-delta') {
    const idx = toolCallIndexMap.get(part.id) ?? 0
    return {
      data: {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: idx, function: { arguments: part.delta } }],
            },
            finish_reason: null,
          },
        ],
      },
    }
  }

  return null
}
