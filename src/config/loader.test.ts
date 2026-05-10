import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, unlinkSync } from 'fs'
import { loadConfig } from './loader.js'

const TMP = '/tmp/chapernoe-test-config.yaml'

function write(content: string) {
  writeFileSync(TMP, content, 'utf-8')
}

afterEach(() => {
  try {
    unlinkSync(TMP)
  } catch {
    // file may not exist between tests — ignore
  }
})

describe('loadConfig', () => {
  it('loads a valid config and resolves env vars', () => {
    process.env['TEST_API_KEY'] = 'sk-test-123'
    write(`
channels:
  my-anthropic:
    type: anthropic
    apiKey: $TEST_API_KEY
models:
  claude:
    channel: my-anthropic
    model: claude-sonnet-4-5
`)
    const config = loadConfig(TMP)
    expect(config.channels).toHaveLength(1)
    expect(config.channels[0]).toMatchObject({
      name: 'my-anthropic',
      type: 'anthropic',
      apiKey: 'sk-test-123',
    })
    expect(config.models['claude']).toMatchObject({
      channel: 'my-anthropic',
      model: 'claude-sonnet-4-5',
    })
    delete process.env['TEST_API_KEY']
  })

  it('throws when a referenced env var is not set', () => {
    delete process.env['MISSING_VAR']
    write(`
channels:
  ch:
    type: openai
    apiKey: $MISSING_VAR
models:
  gpt:
    channel: ch
    model: gpt-4o
`)
    expect(() => loadConfig(TMP)).toThrow('MISSING_VAR')
  })

  it('throws on a dangling channel reference in models', () => {
    process.env['TEST_KEY'] = 'key'
    write(`
channels:
  real-channel:
    type: openai
    apiKey: $TEST_KEY
models:
  my-model:
    channel: nonexistent-channel
    model: gpt-4o
`)
    expect(() => loadConfig(TMP)).toThrow('nonexistent-channel')
    delete process.env['TEST_KEY']
  })

  it('throws on an invalid channel type', () => {
    write(`
channels:
  bad:
    type: not-a-real-type
    apiKey: somekey
models: {}
`)
    expect(() => loadConfig(TMP)).toThrow()
  })

  it('handles multiple channels and models', () => {
    process.env['ANTHROPIC_KEY'] = 'a-key'
    process.env['OPENAI_KEY'] = 'o-key'
    write(`
channels:
  ant:
    type: anthropic
    apiKey: $ANTHROPIC_KEY
  oai:
    type: openai
    apiKey: $OPENAI_KEY
models:
  claude:
    channel: ant
    model: claude-3
  gpt:
    channel: oai
    model: gpt-4o
`)
    const config = loadConfig(TMP)
    expect(config.channels).toHaveLength(2)
    expect(Object.keys(config.models)).toHaveLength(2)
    delete process.env['ANTHROPIC_KEY']
    delete process.env['OPENAI_KEY']
  })
})
