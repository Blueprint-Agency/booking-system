import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { ERROR_CODES, type ErrorCode } from '../shared/error-codes'
import { logger } from '../shared/logger'

export class AppError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 422,
    public code: ErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(status, { message: code })
  }
}

/**
 * The app's `onError`, and the one that actually answers.
 *
 * Hono catches a thrown error at the layer that threw it and hands it to the
 * app's error handler right there, so the `try` in `errorBoundary` below never
 * sees one: without this, an `AppError` went out as its bare code in plain text,
 * and a caller reading `{ error }` off the body found nothing.
 */
export const onAppError = (err: Error, c: Context) => errorResponse(err, c)

export const errorBoundary: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } catch (err) {
    return errorResponse(err, c)
  }
}

function errorResponse(err: unknown, c: Context) {
  if (err instanceof AppError) {
    return c.json({ error: err.code, ...(err.details ?? {}) }, err.status)
  }
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  if (err instanceof ZodError) {
    return c.json({ error: ERROR_CODES.invalid_request, issues: err.issues }, 400)
  }
  // Unknown / programmer error: the one `error` line for it — the error object
  // (so its stack), and the request/tenant/actor ids from the log context — and
  // a generic body that includes the requestId, so a user/support can quote it
  // and we can find the matching line.
  const requestId = c.get('requestId')
  logger.error({ err, method: c.req.method, path: c.req.path }, 'unhandled error')
  return c.json({ error: ERROR_CODES.internal_error, requestId }, 500)
}
