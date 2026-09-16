import type { MiddlewareHandler } from 'hono'
import type { Logger } from '../shared/logger'
import { logger } from '../shared/logger'

declare module 'hono' {
  interface ContextVariableMap {
    /** Request-scoped logger. Its lines carry the request's log context. */
    log: Logger
  }
}

/**
 * Per-request logger + access log.
 *
 * Stashes the root logger on the context as `log`, so a handler can do
 * `c.get('log').info(...)`. It binds nothing of its own: the request, tenant and
 * actor ids come from the log context the root logger reads on every line
 * (shared/logger.ts), and binding `requestId` here too would write it twice.
 * After the response resolves it emits one access-log line with
 * method/path/status/ms.
 *
 * The access line is `info` whatever the status. It is a record of the request,
 * not an alert: an unhandled error already has its own `error` line from the
 * error boundary, and a refusal worth watching has its own `warn` — a second
 * line at the same level would count every failure twice.
 *
 * Must run AFTER `requestId` and OUTSIDE `errorBoundary` so the final status
 * (including a 500 produced by the boundary) is the one we log.
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const log = logger
  c.set('log', log)

  const start = performance.now()
  await next()

  // Health/uptime pings are high-frequency and low-signal — don't access-log them.
  if (c.req.path === '/health' || c.req.path === '/healthz') return

  const ms = Math.round(performance.now() - start)

  log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms }, 'request')
}
