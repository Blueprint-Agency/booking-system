// NOTE: './instrument' MUST be the first import so Sentry (when SENTRY_DSN is
// set) initializes and auto-instruments the runtime before the HTTP server and
// the rest of the app are loaded. captureException is imported from it; the
// import itself triggers Sentry.init.
import { captureException } from './instrument'
import { env } from './env'
import { serve } from '@hono/node-server'
import app from './app'
import { logger } from './shared/logger'
import { closeDb } from './db'

/**
 * Node entry point. `instrument` runs first (error monitoring), then `env` is
 * validated up front — if anything required is missing, boot fails loudly with
 * a Zod error report before we open the HTTP socket.
 *
 * registerJobs is intentionally NOT mounted yet — the cron handlers depend on
 * services that aren't all wired, so enabling them now would throw at boot. The
 * safeJob wrapper in jobs/index.ts is in place for when they're switched on.
 */
const server = serve({ fetch: app.fetch, port: env.PORT }, info => {
  logger.info({ port: info.port, env: env.NODE_ENV }, 'yoga-sadhana-be started')
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
// An unhandled rejection is logged + reported but kept alive (often recoverable).
process.on('unhandledRejection', reason => {
  logger.error({ err: reason }, 'unhandledRejection')
  captureException(reason)
})

// An uncaught exception means unknown state (a programmer error) — log, report,
// then exit so the container restarts clean rather than limping along.
process.on('uncaughtException', err => {
  logger.fatal({ err }, 'uncaughtException — exiting')
  captureException(err)
  shutdown(1, 'uncaughtException')
})
