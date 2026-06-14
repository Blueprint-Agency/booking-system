import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { logger } from '../shared/logger'
import { captureException } from '../instrument'

export class AppError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 422,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(status, { message: code })
  }
}

export const errorBoundary: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } catch (err) {
    if (err instanceof AppError) {
      return c.json({ error: err.code, ...(err.details ?? {}) }, err.status)
    }
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }
    if (err instanceof ZodError) {
      return c.json({ error: 'invalid_request', issues: err.issues }, 400)
    }
    // Unknown / programmer error: log with full context, report to Sentry (if
    // configured), and return a generic body — but include the requestId so a
    // user/support can quote it and we can grep the matching log line.
    const requestId = c.get('requestId')
    const log = c.get('log') ?? logger
    log.error({ err, method: c.req.method, path: c.req.path }, 'unhandled error')
    captureException(err, { requestId, method: c.req.method, path: c.req.path })
    return c.json({ error: 'internal_error', requestId }, 500)
  }
}
