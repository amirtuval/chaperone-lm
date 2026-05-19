import { describe, it, expect } from 'vitest'
import { buildPrompt } from './aisdk-completions.js'
import type { GatewayRequest } from './types.js'

type Msg = GatewayRequest['messages'][number]

describe('buildPrompt', () => {
  describe('system messages', () => {
    it('places a single system message first', () => {
      const prompt = buildPrompt([
        { role: 'system', content: 'Be helpful.' } as Msg,
        { role: 'user', content: 'Hi' } as Msg,
      ])
      expect(prompt[0]).toEqual({ role: 'system', content: 'Be helpful.' })
    })

    it('merges multiple system messages into one', () => {
      const prompt = buildPrompt([
        { role: 'system', content: 'Be helpful.' } as Msg,
        { role: 'system', content: 'Be concise.' } as Msg,
        { role: 'user', content: 'Hi' } as Msg,
      ])
      const sys = prompt.filter((m) => m.role === 'system')
      expect(sys).toHaveLength(1)
      expect(sys[0]).toEqual({ role: 'system', content: 'Be helpful.\n\nBe concise.' })
    })
  })

  describe('user messages', () => {
    it('converts string content to a text part', () => {
      const prompt = buildPrompt([{ role: 'user', content: 'Hello' } as Msg])
      expect(prompt[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hello' }] })
    })

    it('extracts text parts from array content', () => {
      const prompt = buildPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this:' },
            { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
          ],
        } as unknown as Msg,
      ])
      expect(prompt[0]).toEqual({
        role: 'user',
        content: [{ type: 'text', text: 'Look at this:' }],
      })
    })

    it('skips user messages with empty string content', () => {
      const prompt = buildPrompt([{ role: 'user', content: '' } as Msg])
      expect(prompt.filter((m) => m.role === 'user')).toHaveLength(0)
    })

    it('skips empty text parts within array content', () => {
      const prompt = buildPrompt([
        {
          role: 'user',
          content: [{ type: 'text', text: '' }],
        } as unknown as Msg,
      ])
      expect(prompt.filter((m) => m.role === 'user')).toHaveLength(0)
    })
  })

  describe('assistant messages', () => {
    it('converts string content to a text part', () => {
      const prompt = buildPrompt([{ role: 'assistant', content: 'I can help.' } as Msg])
      expect(prompt[0]).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: 'I can help.' }],
      })
    })

    it('skips assistant messages with null content and no tool_calls', () => {
      const prompt = buildPrompt([{ role: 'assistant', content: null } as unknown as Msg])
      expect(prompt.filter((m) => m.role === 'assistant')).toHaveLength(0)
    })

    it('skips assistant messages with empty string content and no tool_calls', () => {
      const prompt = buildPrompt([{ role: 'assistant', content: '' } as Msg])
      expect(prompt.filter((m) => m.role === 'assistant')).toHaveLength(0)
    })

    it('converts tool_calls to tool-call parts (content null)', () => {
      const prompt = buildPrompt([
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"London"}' },
            },
          ],
        } as unknown as Msg,
      ])
      expect(prompt[0]).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'get_weather',
            input: { city: 'London' },
          },
        ],
      })
    })

    it('includes both text and tool_calls when both are present', () => {
      const prompt = buildPrompt([
        {
          role: 'assistant',
          content: 'Let me check that.',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
          ],
        } as unknown as Msg,
      ])
      const msg = prompt[0] as { role: string; content: unknown[] }
      expect(msg.content).toHaveLength(2)
      expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Let me check that.' })
      expect(msg.content[1]).toMatchObject({ type: 'tool-call', toolCallId: 'call-1', input: {} })
    })
  })

  describe('tool result messages', () => {
    it('converts role:tool messages to tool-result parts with correct toolName', () => {
      const prompt = buildPrompt([
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
          ],
        } as unknown as Msg,
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content: '{"temp":20}',
        } as unknown as Msg,
      ])
      const toolMsg = prompt.find((m) => m.role === 'tool') as {
        role: 'tool'
        content: Array<{ type: string; toolCallId: string; toolName: string; output: unknown }>
      }
      expect(toolMsg).toBeDefined()
      expect(toolMsg.content[0]).toEqual({
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'get_weather',
        output: { type: 'text', value: '{"temp":20}' },
      })
    })

    it('JSON-stringifies non-string tool result content', () => {
      const prompt = buildPrompt([
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
        } as unknown as Msg,
        {
          role: 'tool',
          tool_call_id: 'c1',
          content: [{ type: 'text', text: 'result' }],
        } as unknown as Msg,
      ])
      const toolMsg = prompt.find((m) => m.role === 'tool') as {
        content: Array<{ output: { value: string } }>
      }
      expect(toolMsg.content[0].output.value).toBe('[{"type":"text","text":"result"}]')
    })
  })

  describe('full multi-turn conversation', () => {
    it('builds a correct prompt for a complete tool-call round trip', () => {
      const prompt = buildPrompt([
        { role: 'system', content: 'You are helpful.' } as Msg,
        { role: 'user', content: "What's the weather?" } as Msg,
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"London"}' },
            },
          ],
        } as unknown as Msg,
        { role: 'tool', tool_call_id: 'c1', content: '{"temp":15}' } as unknown as Msg,
        { role: 'assistant', content: "It's 15°C in London." } as Msg,
        { role: 'user', content: 'Thanks!' } as Msg,
      ])

      expect(prompt.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'tool',
        'assistant',
        'user',
      ])
    })
  })
})
