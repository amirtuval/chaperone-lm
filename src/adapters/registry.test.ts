import { describe, it, expect } from 'vitest'
import { buildCompletionsRegistry, buildMessagesRegistry } from './registry.js'
import { AISdkCompletionsAdapter } from './aisdk-completions.js'
import { AISdkMessagesAdapter } from './aisdk-messages.js'
import { OpenAIPassthroughAdapter } from './passthrough-openai.js'
import { AnthropicPassthroughAdapter } from './passthrough-anthropic.js'
import type { AppConfig } from '../types.js'

function makeConfig(channelType: string, channelExtra: object = {}): AppConfig {
  return {
    channels: [
      { name: 'ch', type: channelType as 'anthropic', ...channelExtra } as AppConfig['channels'][0],
    ],
    models: { 'my-model': { channel: 'ch', model: 'some-model' } },
  }
}

describe('buildCompletionsRegistry', () => {
  it('maps each model alias to its adapter', () => {
    const config: AppConfig = {
      channels: [{ name: 'ant', type: 'anthropic', apiKey: 'key' }],
      models: {
        'claude-sonnet': { channel: 'ant', model: 'claude-sonnet-4-5' },
        'claude-haiku': { channel: 'ant', model: 'claude-haiku-4-5' },
      },
    }
    const registry = buildCompletionsRegistry(config)
    expect(registry.size).toBe(2)
    expect(registry.has('claude-sonnet')).toBe(true)
    expect(registry.has('claude-haiku')).toBe(true)
  })

  it('skips aliases whose channel is not declared', () => {
    const config: AppConfig = {
      channels: [{ name: 'ant', type: 'anthropic', apiKey: 'key' }],
      models: {
        good: { channel: 'ant', model: 'claude-haiku-4-5' },
        bad: { channel: 'nonexistent', model: 'whatever' },
      },
    }
    const registry = buildCompletionsRegistry(config)
    expect(registry.size).toBe(1)
    expect(registry.has('good')).toBe(true)
    expect(registry.has('bad')).toBe(false)
  })

  it('creates AISdkCompletionsAdapter for anthropic channels', () => {
    const config = makeConfig('anthropic', { apiKey: 'key' })
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkCompletionsAdapter)
  })

  it('creates AISdkCompletionsAdapter for openai channels', () => {
    const config = makeConfig('openai', { apiKey: 'key' })
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkCompletionsAdapter)
  })

  it('creates AISdkCompletionsAdapter for google channels', () => {
    const config = makeConfig('google', { apiKey: 'key' })
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkCompletionsAdapter)
  })

  it('creates AISdkCompletionsAdapter for bedrock channels', () => {
    const config = makeConfig('bedrock', { region: 'us-east-1' })
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkCompletionsAdapter)
  })

  it('creates AISdkCompletionsAdapter for vertex channels (gemini)', () => {
    const config = makeConfig('vertex', {
      project: 'my-project',
      region: 'us-central1',
      provider: 'gemini',
    })
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkCompletionsAdapter)
  })

  it('creates AISdkCompletionsAdapter for vertex channels (anthropic backend)', () => {
    const config = makeConfig('vertex', {
      project: 'my-project',
      region: 'us-east5',
      provider: 'anthropic',
    })
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkCompletionsAdapter)
  })

  it('creates AISdkCompletionsAdapter for azure channels', () => {
    const config: AppConfig = {
      channels: [{ name: 'ch', type: 'azure', resourceName: 'my-resource', apiKey: 'key' }],
      models: { 'my-model': { channel: 'ch', model: 'gpt-4o', deploymentId: 'gpt-4o-deploy' } },
    }
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkCompletionsAdapter)
  })

  it('creates OpenAIPassthroughAdapter for llm-server channels', () => {
    const config = makeConfig('llm-server', {
      baseUrl: 'https://openrouter.ai/api/v1',
      protocols: ['openai'],
    })
    const registry = buildCompletionsRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(OpenAIPassthroughAdapter)
  })

  it('returns an empty registry for empty models', () => {
    const config: AppConfig = {
      channels: [{ name: 'ant', type: 'anthropic', apiKey: 'key' }],
      models: {},
    }
    const registry = buildCompletionsRegistry(config)
    expect(registry.size).toBe(0)
  })
})

describe('buildMessagesRegistry', () => {
  it('creates AnthropicPassthroughAdapter for anthropic channels', () => {
    const config = makeConfig('anthropic', { apiKey: 'key' })
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AnthropicPassthroughAdapter)
  })

  it('creates AISdkMessagesAdapter for openai channels', () => {
    const config = makeConfig('openai', { apiKey: 'key' })
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkMessagesAdapter)
  })

  it('creates AISdkMessagesAdapter for google channels', () => {
    const config = makeConfig('google', { apiKey: 'key' })
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkMessagesAdapter)
  })

  it('creates AISdkMessagesAdapter for bedrock channels', () => {
    const config = makeConfig('bedrock', { region: 'us-east-1' })
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkMessagesAdapter)
  })

  it('creates AISdkMessagesAdapter for vertex channels', () => {
    const config = makeConfig('vertex', { project: 'p', region: 'us-central1', provider: 'gemini' })
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkMessagesAdapter)
  })

  it('creates AISdkMessagesAdapter for azure channels', () => {
    const config: AppConfig = {
      channels: [{ name: 'ch', type: 'azure', resourceName: 'my-resource', apiKey: 'key' }],
      models: { 'my-model': { channel: 'ch', model: 'gpt-4o', deploymentId: 'gpt-4o-deploy' } },
    }
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkMessagesAdapter)
  })

  it('creates AnthropicPassthroughAdapter for llm-server with anthropic protocol', () => {
    const config = makeConfig('llm-server', {
      baseUrl: 'https://my-llm-server',
      protocols: ['anthropic'],
    })
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AnthropicPassthroughAdapter)
  })

  it('creates AISdkMessagesAdapter for llm-server with only openai protocol', () => {
    const config = makeConfig('llm-server', {
      baseUrl: 'https://openrouter.ai/api/v1',
      protocols: ['openai'],
    })
    const registry = buildMessagesRegistry(config)
    expect(registry.get('my-model')).toBeInstanceOf(AISdkMessagesAdapter)
  })
})
