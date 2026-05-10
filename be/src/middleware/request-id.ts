import type { MiddlewareHandler } from 'hono'
import { randomUUID } from 'node:crypto'

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

export const requestId: MiddlewareHandler = async (c, next) => {
  const id = c.req.header('x-request-id') ?? randomUUID()
  c.set('requestId', id)
  c.header('x-request-id', id)
  await next()
}
