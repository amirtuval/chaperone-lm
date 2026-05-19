import 'dotenv/config'
import { loadConfig } from './config/loader.js'
import { buildAdapterRegistry } from './adapters/registry.js'
import { createApp } from './server.js'
import { logger } from './logger.js'

const configPath = process.env['CONFIG_PATH'] ?? './config.yaml'
const port = parseInt(process.env['PORT'] ?? '3000', 10)

try {
  const config = loadConfig(configPath)
  const adapterRegistry = buildAdapterRegistry(config.channels)
  const app = createApp(config, adapterRegistry)

  app.listen(port, () => {
    logger.info({ port }, 'chaperone-lm listening')
  })
} catch (err) {
  logger.error({ err }, 'failed to start')
  process.exit(1)
}
