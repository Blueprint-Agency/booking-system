import type { MiddlewareHandler } from 'hono'
import { randomUUID } from 'node:crypto'
import { runWithLogContext } from '../shared/logger'

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

/**
 * Names the request, and opens its log context: every line written from here
 * on — by middleware or by a service — carries `requestId`, and whatever the
 * later middlewares add (shared/logger.ts). Mounted first, so nothing runs
 * outside it.
 */
export const requestId: MiddlewareHandler = async (c, next) => {
  const id = c.req.header('x-request-id') ?? randomUUID()
  c.set('requestId', id)
  c.header('x-request-id', id)
  await runWithLogContext({ requestId: id }, () => next())
}
