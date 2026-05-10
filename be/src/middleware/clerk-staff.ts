import type { MiddlewareHandler } from 'hono'
import { verifyToken } from '@clerk/backend'
import { db } from '../db'
import { staffUsers } from '../db/schema/identity'
import { eq } from 'drizzle-orm'

export interface ClerkStaffClaims {
  sub: string
}

declare module 'hono' {
  interface ContextVariableMap {
    staffClaims: ClerkStaffClaims
    staffUserId: string
    staffRow: typeof staffUsers.$inferSelect
    actingAs?: string
    impersonatedBy?: string
  }
}

export const clerkStaffAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_bearer_token' }, 401)
  }
  const token = header.slice(7)

  let payload: any
  try {
    payload = await verifyToken(token, {
      secretKey: process.env.CLERK_STAFF_SECRET_KEY!,
      authorizedParties: process.env.CLERK_STAFF_AUTHORIZED_PARTIES?.split(','),
    })
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const [row] = await db.select().from(staffUsers).where(eq(staffUsers.clerkUserId, payload.sub)).limit(1)
  if (!row) return c.json({ error: 'staff_not_found' }, 404)

  c.set('staffClaims', { sub: payload.sub })
  c.set('staffUserId', row.id)
  c.set('staffRow', row)

  await next()
}

export const requireActiveStaff: MiddlewareHandler = async (c, next) => {
  const row = c.get('staffRow')
  if (row.status !== 'active') {
    return c.json({ error: 'staff_inactive' }, 403)
  }
  await next()
}
