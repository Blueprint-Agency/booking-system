import { env } from './env'
import { serve } from '@hono/node-server'
import app from './app'
import { logger } from './shared/logger'
import { closeDb } from './db'
import { reportStatementDescriptorPrefix } from './lib/stripe'

/**
 * Node entry point. `env` is validated up front — if anything required is
 * missing, boot fails loudly with a Zod error report before we open the HTTP
 * socket.
 *
 * Background lifecycle jobs always start here — they are not optional. Tests
 * import `app`, not this file, so they never run them.
 */
// Payment configuration that is wrong but not fatal — an unset statement
// descriptor prefix means every studio's charges carry the platform's name.
// Said here, at boot, because the charge path deliberately stays silent.
reportStatementDescriptorPrefix()

const server = serve({ fetch: app.fetch, port: env.PORT }, info => {
  logger.info({ port: info.port, env: env.NODE_ENV }, 'reservetoday-be started')
})

void import('./jobs')
  .then(({ registerJobs }) => registerJobs())
  .then(() => {
    logger.info('background jobs registered')
  })
  .catch(err => {
    logger.error({ err }, 'failed to register background jobs')
  })

// ---- Graceful shutdown -------------------------------------------------------
// Docker sends SIGTERM on `stop`/redeploy; drain in-flight requests, then exit.
let shuttingDown = false
function shutdown(code: number, reason: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ reason }, 'shutting down')
  server.close(async () => {
    logger.info('http server closed')
    try {
      await closeDb()
    } catch (err) {
      logger.error({ err }, 'error closing db pool')
    }
    process.exit(code)
  })
  // Safety net: force-exit if connections don't drain in time.
  setTimeout(() => {
    logger.error('forced exit — shutdown timed out')
    process.exit(code)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown(0, 'SIGTERM'))
process.on('SIGINT', () => shutdown(0, 'SIGINT'))

// ---- Process-level safety nets -----------------------------------------------
// An unhandled rejection is logged but kept alive (often recoverable).
process.on('unhandledRejection', reason => {
  logger.error({ err: reason }, 'unhandledRejection')
})

// An uncaught exception means unknown state (a programmer error) — log, then
// exit so the container restarts clean rather than limping along.
process.on('uncaughtException', err => {
  logger.fatal({ err }, 'uncaughtException — exiting')
  shutdown(1, 'uncaughtException')
})
