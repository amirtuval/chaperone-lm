import { readFileSync } from 'fs'
import { resolve } from 'path'

export function setup() {
  try {
    const envPath = resolve(process.cwd(), '.env')
    const contents = readFileSync(envPath, 'utf8')
    const lines = contents.split(String.fromCharCode(10))
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key && !(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch {
    // No .env file — CI supplies env vars directly
  }
}
