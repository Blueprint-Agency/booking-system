import type { MiddlewareHandler } from 'hono'
import { verifyToken } from '@clerk/backend'
import { db } from '../db'
import { clients } from '../db/schema/identity'
import { eq } from 'drizzle-orm'
import { clerkStaffApp } from '../lib/clerk'

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
    // fe-client currently shares the staff Clerk app (CLERK_STAFF_SECRET_KEY).
    // When a dedicated client Clerk app is created, swap this to CLERK_SECRET_KEY.
    payload = await verifyToken(token, {
      secretKey: process.env.CLERK_STAFF_SECRET_KEY!,
    })
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const claims: ClerkClientClaims = {
    sub: payload.sub,
    email_verified: payload.email_verified,
    phone_verified: payload.phone_verified,
  }

  let [row] = await db.select().from(clients).where(eq(clients.clerkUserId, payload.sub)).limit(1)

  // Auto-create clients row on first authenticated request (lazy registration).
  // This covers dev testing and the case where the Clerk webhook fires before
  // the full handleClerkEvent is implemented.
  if (!row) {
    let name = 'Member'
    let email = `${payload.sub}@unknown.local`
    let phone = ''

    try {
      // fe-client shares the staff Clerk app for now — use clerkStaffApp.
      // When a dedicated client Clerk app exists, switch to clerkClientApp.
      const clerkUser = await clerkStaffApp.users.getUser(payload.sub)
      name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || 'Member'
      email = clerkUser.emailAddresses[0]?.emailAddress ?? email
      phone = clerkUser.phoneNumbers[0]?.phoneNumber ?? ''
    } catch {
      // Clerk lookup failed — proceed with fallback values
    }

    const [inserted] = await db.insert(clients).values({
      clerkUserId: payload.sub,
      name,
      email,
      phone,
    }).onConflictDoNothing().returning()

    if (!inserted) {
      // Race condition: another request inserted first — re-fetch
      const [refetched] = await db.select().from(clients).where(eq(clients.clerkUserId, payload.sub)).limit(1)
      if (!refetched) return c.json({ error: 'client_not_found' }, 404)
      row = refetched
    } else {
      row = inserted
    }
  }

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
  // Email is always verified at Clerk sign-up. Phone verification is required
  // before booking (not before purchasing) — Stripe handles payment security.
  if (!claims.phone_verified) {
    return c.json(
      {
        error: 'verification_required',
        missing: { email: false, phone: true },
      },
      403,
    )
  }
  await next()
}
