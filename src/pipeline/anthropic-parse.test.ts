import { describe, it, expect } from 'vitest'
import { parseAnthropicRequest } from './anthropic-parse.js'
import type { AnthropicMessagesRequest } from './anthropic-parse.js'

function makeRequest(overrides: Partial<AnthropicMessagesRequest> = {}): AnthropicMessagesRequest {
  return {
    model: 'claude-sonnet',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 100,
    ...overrides,
  }
}

describe('parseAnthropicRequest', () => {
  it('maps a simple string user message', () => {
    const opts = parseAnthropicRequest(makeRequest())
    const userMsg = opts.prompt.find((m) => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('sets maxOutputTokens and temperature', () => {
    const opts = parseAnthropicRequest(makeRequest({ max_tokens: 512, temperature: 0.7 }))
    expect(opts.maxOutputTokens).toBe(512)
    expect(opts.temperature).toBe(0.7)
  })

  it('converts string system prompt to prompt entry', () => {
    const opts = parseAnthropicRequest(makeRequest({ system: 'Be helpful.' }))
    const sys = opts.prompt.find((m) => m.role === 'system')
    expect(sys?.content).toBe('Be helpful.')
  })

  it('converts array system prompt to joined string', () => {
    const opts = parseAnthropicRequest(
      makeRequest({
        system: [
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
        ],
      })
    )
    const sys = opts.prompt.find((m) => m.role === 'system')
    expect(sys?.content).toBe('A\n\nB')
  })

  it('maps tool_use block in assistant message to tool-call', () => {
    const req = makeRequest({
      messages: [
        { role: 'user', content: 'Use a tool' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu1', name: 'get_weather', input: { city: 'NYC' } }],
        },
      ],
    })
    const opts = parseAnthropicRequest(req)
    const assistantMsg = opts.prompt.find((m) => m.role === 'assistant')
    expect(assistantMsg?.content).toEqual([
      { type: 'tool-call', toolCallId: 'tu1', toolName: 'get_weather', input: { city: 'NYC' } },
    ])
  })

  it('maps tool_result block in user message to tool role message', () => {
    const req = makeRequest({
      messages: [
        { role: 'user', content: 'Use a tool' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu1', name: 'get_weather', input: { city: 'NYC' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Sunny, 72F' }],
        },
      ],
    })
    const opts = parseAnthropicRequest(req)
    const toolMsg = opts.prompt.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg!.content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'tu1',
      toolName: 'get_weather',
    })
  })

  it('maps tools to LanguageModelV3FunctionTool', () => {
    const opts = parseAnthropicRequest(
      makeRequest({
        tools: [
          { name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' } },
        ],
      })
    )
    expect(opts.tools).toHaveLength(1)
    expect(opts.tools![0]).toEqual({
      type: 'function',
      name: 'get_weather',
      description: 'Get weather',
      inputSchema: { type: 'object' },
    })
  })

  it('maps tool_choice auto → auto', () => {
    const opts = parseAnthropicRequest(makeRequest({ tool_choice: { type: 'auto' } }))
    expect(opts.toolChoice).toEqual({ type: 'auto' })
  })

  it('maps tool_choice any → required', () => {
    const opts = parseAnthropicRequest(makeRequest({ tool_choice: { type: 'any' } }))
    expect(opts.toolChoice).toEqual({ type: 'required' })
  })

  it('maps tool_choice none → none', () => {
    const opts = parseAnthropicRequest(makeRequest({ tool_choice: { type: 'none' } }))
    expect(opts.toolChoice).toEqual({ type: 'none' })
  })

  it('maps tool_choice tool → tool with toolName', () => {
    const opts = parseAnthropicRequest(
      makeRequest({ tool_choice: { type: 'tool', name: 'get_weather' } })
    )
    expect(opts.toolChoice).toEqual({ type: 'tool', toolName: 'get_weather' })
  })

  it('includes no tools when empty array', () => {
    const opts = parseAnthropicRequest(makeRequest({ tools: [] }))
    expect(opts.tools).toBeUndefined()
  })

  it('splits mixed user message: text goes to user role, tool_result to tool role', () => {
    const req = makeRequest({
      messages: [
        { role: 'user', content: 'Use a tool' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu1', name: 'fn', input: {} }],
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Here is the result:' },
            { type: 'tool_result', tool_use_id: 'tu1', content: 'result' },
          ],
        },
      ],
    })
    const opts = parseAnthropicRequest(req)
    const userMsgs = opts.prompt.filter((m) => m.role === 'user')
    const toolMsgs = opts.prompt.filter((m) => m.role === 'tool')
    expect(userMsgs.length).toBeGreaterThan(0)
    expect(toolMsgs.length).toBe(1)
  })

  it('maps base64 image block to file part', () => {
    const req = makeRequest({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
            },
          ],
        },
      ],
    })
    const opts = parseAnthropicRequest(req)
    const userMsg = opts.prompt.find((m) => m.role === 'user')
    expect(userMsg!.content[0]).toMatchObject({
      type: 'file',
      data: 'abc123',
      mediaType: 'image/png',
    })
  })
})
