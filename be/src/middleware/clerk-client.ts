import type { MiddlewareHandler } from 'hono'
import { verifyToken } from '@clerk/backend'
import { db } from '../db'
import { clients } from '../db/schema/identity'
import { eq } from 'drizzle-orm'

export interface ClerkClientClaims {
  sub: string
  email_verified?: boolean
  phone_verified?: boolean
}

declare module 'hono' {
  interface ContextVariableMap {
    clerkClaims: ClerkClientClaims
    clientId: string
    clientRow: typeof clients.$inferSelect
  }
}

export const clerkClientAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_bearer_token' }, 401)
  }
  const token = header.slice(7)

  let payload: any
  try {
    payload = await verifyToken(token, {
      secretKey: process.env.CLERK_CLIENT_SECRET_KEY!,
      authorizedParties: process.env.CLERK_CLIENT_AUTHORIZED_PARTIES?.split(','),
    })
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const claims: ClerkClientClaims = {
    sub: payload.sub,
    email_verified: payload.email_verified,
    phone_verified: payload.phone_verified,
  }

  const [row] = await db.select().from(clients).where(eq(clients.clerkUserId, payload.sub)).limit(1)
  if (!row) return c.json({ error: 'client_not_found' }, 404)

  c.set('clerkClaims', claims)
  c.set('clientId', row.id)
  c.set('clientRow', row)

  await next()
}

export const requireActiveClient: MiddlewareHandler = async (c, next) => {
  const row = c.get('clientRow')
  if (row.status !== 'active') {
    return c.json({ error: 'client_suspended' }, 403)
  }
  await next()
}

export const requireVerified: MiddlewareHandler = async (c, next) => {
  const claims = c.get('clerkClaims')
  if (!claims.email_verified || !claims.phone_verified) {
    return c.json(
      {
        error: 'verification_required',
        missing: { email: !claims.email_verified, phone: !claims.phone_verified },
      },
      403,
    )
  }
  await next()
}
