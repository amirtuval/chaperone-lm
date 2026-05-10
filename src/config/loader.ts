import { readFileSync } from 'fs'
import { load as parseYaml } from 'js-yaml'
import { appConfigSchema } from './schema.js'
import type { AppConfig } from '../types.js'

/**
 * Recursively walk a parsed YAML value and resolve $VAR references
 * from process.env. Throws if a referenced variable is not set.
 */
function resolveEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('$')) {
      const varName = value.slice(1)
      const resolved = process.env[varName]
      if (resolved === undefined) {
        throw new Error(`Environment variable $${varName} is not set`)
      }
      return resolved
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(resolveEnvVars)
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = resolveEnvVars(v)
    }
    return result
  }

  return value
}

/**
 * Normalise the raw YAML structure.
 *
 * The YAML format uses a map keyed by channel name:
 *   channels:
 *     my-channel:
 *       type: anthropic
 *       apiKey: ...
 *
 * The AppConfig type represents channels as an array where each element
 * carries a `name` field. This function converts between the two forms.
 */
function normalise(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw
  }

  const obj = raw as Record<string, unknown>

  if ('channels' in obj && obj.channels !== null && typeof obj.channels === 'object' && !Array.isArray(obj.channels)) {
    const channelsMap = obj.channels as Record<string, unknown>
    const channelsArray = Object.entries(channelsMap).map(([name, config]) => {
      if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
        return { name, ...(config as Record<string, unknown>) }
      }
      return config
    })
    return { ...obj, channels: channelsArray }
  }

  return obj
}

export function loadConfig(filePath: string): AppConfig {
  let fileContent: string
  try {
    fileContent = readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read config file "${filePath}": ${(err as Error).message}`)
  }

  const raw = parseYaml(fileContent)
  const normalised = normalise(raw)
  const resolved = resolveEnvVars(normalised)

  const parseResult = appConfigSchema.safeParse(resolved)
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map(i => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${issues}`)
  }

  const config = parseResult.data as AppConfig

  // Validate that every models[x].channel references a declared channel name
  const channelNames = new Set(config.channels.map(ch => ch.name))
  for (const [alias, modelConfig] of Object.entries(config.models)) {
    if (!channelNames.has(modelConfig.channel)) {
      throw new Error(
        `Model alias "${alias}" references undeclared channel "${modelConfig.channel}". ` +
          `Declared channels: ${[...channelNames].join(', ')}`
      )
    }
  }

  return config
}
