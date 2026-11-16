import app from './app.js'
import { config } from './config/environment.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import { logger } from './utils/logger.js'

async function main() {
  await connectDatabase()
  const server = app.listen(config.PORT, () => logger.info(`EstateFlow API on http://localhost:${config.PORT}/api/v1 (${config.NODE_ENV})`))

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`)
    server.close(async () => { await disconnectDatabase(); process.exit(0) })
    setTimeout(() => process.exit(1), 10000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled rejection'))
}

main().catch((err) => { logger.fatal({ err }, 'Failed to start server'); process.exit(1) })
