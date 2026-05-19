import 'dotenv/config'
import { loadConfig } from './config/loader.js'
import { buildCompletionsRegistry, buildMessagesRegistry } from './adapters/registry.js'
import { createApp } from './server.js'
import { logger } from './logger.js'

const configPath = process.env['CONFIG_PATH'] ?? './config.yaml'
const port = parseInt(process.env['PORT'] ?? '3000', 10)

try {
  const config = loadConfig(configPath)
  const completionsRegistry = buildCompletionsRegistry(config)
  const messagesRegistry = buildMessagesRegistry(config)
  const app = createApp(config, completionsRegistry, messagesRegistry)

  app.listen(port, () => {
    logger.info({ port }, 'chaperone-lm listening')
  })
} catch (err) {
  logger.error({ err }, 'failed to start')
  process.exit(1)
}
