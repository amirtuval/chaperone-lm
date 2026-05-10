import { loadConfig } from './config/loader.js'
import { buildAdapterRegistry } from './adapters/registry.js'
import { createApp } from './server.js'

const configPath = process.env['CONFIG_PATH'] ?? './config.yaml'
const port = parseInt(process.env['PORT'] ?? '3000', 10)

try {
  const config = loadConfig(configPath)
  const adapterRegistry = buildAdapterRegistry(config.channels)
  const app = createApp(config, adapterRegistry)

  app.listen(port, () => {
    console.log(`chapernoe-lm listening on port ${port}`)
  })
} catch (err) {
  console.error('Failed to start:', err instanceof Error ? err.message : err)
  process.exit(1)
}
