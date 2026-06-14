import type { MiddlewareHandler } from 'hono'
import type { Logger } from '../shared/logger'
import { logger } from '../shared/logger'

declare module 'hono' {
  interface ContextVariableMap {
    /** Request-scoped child logger, pre-tagged with the requestId. */
    log: Logger
  }
}

/**
 * Per-request logger + access log.
 *
 * Creates a child logger tagged with the requestId (set upstream by the
 * `requestId` middleware) and stashes it on the context as `log`, so any handler
 * can do `c.get('log').info(...)` and have it correlate to the request. After
 * the response resolves it emits one access-log line with method/path/status/ms.
 *
 * Must run AFTER `requestId` and OUTSIDE `errorBoundary` so the final status
 * (including a 500 produced by the boundary) is the one we log.
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const log = logger.child({ requestId: c.get('requestId') })
  c.set('log', log)

  const start = performance.now()
  await next()

  // Health/uptime pings are high-frequency and low-signal — don't access-log them.
  if (c.req.path === '/health' || c.req.path === '/healthz') return

  const ms = Math.round(performance.now() - start)

  const payload = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms,
  }
  if (c.res.status >= 500) log.error(payload, 'request failed')
  else if (c.res.status >= 400) log.warn(payload, 'request rejected')
  else log.info(payload, 'request')
}
