import type { MiddlewareHandler } from 'hono'
import { db } from '../db'
import { clients } from '../db/schema/identity'
import { eq } from 'drizzle-orm'
import { getClerkClientApp, verifyClientToken } from '../lib/clerk'
import { syncClientFromClerk } from '../services/auth/webhook-sync'
import { logger } from '../shared/logger'
import { captureException } from '../instrument'
import { tenantMatches } from './tenant'

export interface ClerkClientClaims {
  sub: string
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
  return syncClientFromClerk(
    {
      id: payload.sub,
      primary_email_address_id: 'token',
      email_addresses: [{ id: 'token', email_address: email }],
      primary_phone_number_id: phone ? 'token' : null,
      phone_numbers: phone ? [{ id: 'token', phone_number: phone }] : [],
      first_name: str(payload.first_name) ?? str(payload.given_name),
      last_name: str(payload.last_name) ?? str(payload.family_name),
      username: str(payload.username),
    },
    { emailVerified: payload.email_verified === true },
  )
}

/** Fallback: fetch the full Clerk profile and provision from it. */
async function provisionFromClerkApi(sub: string): Promise<ClientSyncOutcome> {
  const clerkUser = await getClerkClientApp().users.getUser(sub)
  const primaryEmail = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)
  const emailVerified = primaryEmail?.verification?.status === 'verified'
  return syncClientFromClerk(
    {
      id: clerkUser.id,
      primary_email_address_id: clerkUser.primaryEmailAddressId,
      email_addresses: clerkUser.emailAddresses.map(e => ({ id: e.id, email_address: e.emailAddress })),
      primary_phone_number_id: clerkUser.primaryPhoneNumberId,
      phone_numbers: clerkUser.phoneNumbers.map(p => ({ id: p.id, phone_number: p.phoneNumber })),
      first_name: clerkUser.firstName,
      last_name: clerkUser.lastName,
      username: clerkUser.username,
    },
    { emailVerified },
  )
}

export const clerkClientAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_bearer_token' }, 401)
  }
  const token = header.slice(7)

  let payload: any
  try {
    // fe-client is wired to the dedicated CLIENT Clerk app (separate publishable
    // + secret per spec §6a). Cross-app tokens — including staff tokens — must
    // be rejected: verifyClientToken uses CLERK_CLIENT_SECRET_KEY's JWKS.
    payload = await verifyClientToken(token)
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const claims: ClerkClientClaims = {
    sub: payload.sub,
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
      // Prefer the verified token claims (no Clerk API round-trip). Fall back to
      // the Clerk Backend API when the token carries no email *or* when the claims
      // path hit an email conflict it couldn't resolve — the API is authoritative
      // for email verification, which gates re-linking a pre-existing row (see
      // syncClientFromClerk).
      let sync = await provisionFromClaims(payload)
      if (!sync || sync.kind === 'email_conflict') {
        sync = await provisionFromClerkApi(payload.sub)
      }
      if (sync && (sync.kind === 'created' || sync.kind === 'updated' || sync.kind === 'idempotent')) {
        ;[row] = await db.select().from(clients).where(eq(clients.id, sync.clientId)).limit(1)
      }
    } catch (err) {
      logger.warn({ err }, 'clerk-client: auto-provision failed')
      captureException(err, { scope: 'clerk-client-auto-provision' })
    }
  }

  if (!row) return c.json({ error: 'client_not_found' }, 404)

  // See the same check in clerk-staff.ts: the tenant header is resolved but not
  // yet validated, and this is the first point where the caller's real tenant is
  // known. A member of one studio naming another is refused here rather than
  // being handed that studio's data by every scoped service downstream.
  if (!tenantMatches(c, row.tenantId)) {
    return c.json({ error: 'tenant_mismatch' }, 403)
  }

  c.set('clerkClaims', claims)
  c.set('clientId', row.id)
  c.set('clientRow', row)

  await next()
}

export const requireActiveClient: MiddlewareHandler = async (c, next) => {
  const row = c.get('clientRow')
  // Blocking sets deleted_at and bans the user in Clerk, but that Clerk call is
  // best-effort (see softDeleteClient) — so enforce it here too rather than
  // trusting the ban to have landed.
  if (row.deletedAt || row.status !== 'active') {
    return c.json({ error: 'client_blocked' }, 403)
  }
  await next()
}
