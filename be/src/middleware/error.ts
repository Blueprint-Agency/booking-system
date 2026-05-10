import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

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
    console.error('[unhandled]', err)
    return c.json({ error: 'internal_error' }, 500)
  }
}
