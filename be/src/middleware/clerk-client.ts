import type { MiddlewareHandler } from 'hono'
import { verifyToken } from '@clerk/backend'
import { db } from '../db'
import { clients } from '../db/schema/identity'
import { eq } from 'drizzle-orm'
import { getClerkClientApp } from '../lib/clerk'
import { syncClientFromClerk } from '../services/auth/webhook-sync'

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

type ClientSyncOutcome = Awaited<ReturnType<typeof syncClientFromClerk>>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/**
 * Provision from the verified session-token claims alone — no Clerk API call.
 * Returns null when the token has no email claim, signalling the caller to fall
 * back to the Backend API. Clerk claim keys follow the OIDC-style shortcodes the
 * client app's session token already uses (email / email_verified / …).
 */
async function provisionFromClaims(payload: any): Promise<ClientSyncOutcome | null> {
  const email = str(payload.email)
  if (!email) return null
  const phone = str(payload.phone_number)
  return syncClientFromClerk({
    id: payload.sub,
    primary_email_address_id: 'token',
    email_addresses: [{ id: 'token', email_address: email }],
    primary_phone_number_id: phone ? 'token' : null,
    phone_numbers: phone ? [{ id: 'token', phone_number: phone }] : [],
    first_name: str(payload.first_name) ?? str(payload.given_name),
    last_name: str(payload.last_name) ?? str(payload.family_name),
    username: str(payload.username),
  })
}

/** Fallback: fetch the full Clerk profile and provision from it. */
async function provisionFromClerkApi(sub: string): Promise<ClientSyncOutcome> {
  const clerkUser = await getClerkClientApp().users.getUser(sub)
  return syncClientFromClerk({
    id: clerkUser.id,
    primary_email_address_id: clerkUser.primaryEmailAddressId,
    email_addresses: clerkUser.emailAddresses.map(e => ({ id: e.id, email_address: e.emailAddress })),
    primary_phone_number_id: clerkUser.primaryPhoneNumberId,
    phone_numbers: clerkUser.phoneNumbers.map(p => ({ id: p.id, phone_number: p.phoneNumber })),
    first_name: clerkUser.firstName,
    last_name: clerkUser.lastName,
    username: clerkUser.username,
  })
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

  let [row] = await db.select().from(clients).where(eq(clients.clerkUserId, payload.sub)).limit(1)

  // Auto-provision: a self-registered member's clients row is normally inserted
  // by the Clerk `user.created` webhook, but in prod that webhook may be
  // unconfigured, lag the user's first authenticated request (webhooks are
  // async), or only fire later — leaving every /me/* request to 404 until then.
  // Members may self-register, so we provision the row here on first authed hit.
  //
  // We prefer the *verified token's own claims* (the client session token is
  // customised with email/verification claims — see backend-architecture.md),
  // which needs no Clerk API round-trip. We only call the Clerk Backend API as a
  // fallback when the token doesn't carry the email. Both paths funnel through
  // syncClientFromClerk so the insert + email-conflict guard stay in one place.
  if (!row) {
    try {
      const sync = (await provisionFromClaims(payload)) ?? (await provisionFromClerkApi(payload.sub))
      if (sync && (sync.kind === 'created' || sync.kind === 'updated' || sync.kind === 'idempotent')) {
        ;[row] = await db.select().from(clients).where(eq(clients.id, sync.clientId)).limit(1)
      }
    } catch (err) {
      console.warn('[clerk-client] auto-provision failed:', err)
    }
  }

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
