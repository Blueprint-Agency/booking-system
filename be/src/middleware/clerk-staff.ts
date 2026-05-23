import type { MiddlewareHandler } from 'hono'
import { eq } from 'drizzle-orm'
import { clerkStaffApp, verifyStaffToken } from '../lib/clerk'
import { db } from '../db'
import { staffUsers } from '../db/schema/identity'
import { syncStaffFromClerk } from '../services/auth/webhook-sync'

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
    impersonatedClientId?: string
  }
}

/**
 * Verifies a Clerk staff JWT (Authorization: Bearer <jwt>), looks up the matching
 * staff_users row by clerk_user_id, and attaches both to the Hono context.
 *
 *   401 — missing/invalid token
 *   403 — token is valid but no staff_users row links to that clerk_user_id
 *         (i.e. a rogue Clerk signup with no admin seed). Active gate is enforced
 *         separately by requireActiveStaff.
 */
export const clerkStaffAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_bearer_token' }, 401)
  }
  const token = header.slice(7).trim()
  if (!token) {
    return c.json({ error: 'missing_bearer_token' }, 401)
  }

  let payload: { sub: string }
  try {
    payload = await verifyStaffToken(token)
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }

  let [row] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.clerkUserId, payload.sub))
    .limit(1)

  // Auto-link fallback: webhook hasn't fired (e.g. no ngrok in dev) but the
  // signed-in Clerk user matches a pre-seeded/invited staff_users row by email.
  // Same gate as the webhook — only emails already in staff_users get a role.
  if (!row) {
    try {
      const clerkUser = await clerkStaffApp.users.getUser(payload.sub)
      const sync = await syncStaffFromClerk({
        id: clerkUser.id,
        primary_email_address_id: clerkUser.primaryEmailAddressId,
        email_addresses: clerkUser.emailAddresses.map(e => ({
          id: e.id,
          email_address: e.emailAddress,
        })),
        first_name: clerkUser.firstName,
        last_name: clerkUser.lastName,
        username: clerkUser.username,
      })
      if (sync.kind === 'linked' || sync.kind === 'idempotent') {
        ;[row] = await db
          .select()
          .from(staffUsers)
          .where(eq(staffUsers.id, sync.staffUserId))
          .limit(1)
      }
    } catch (err) {
      console.warn('[clerk-staff] auto-link fallback failed:', err)
    }
  }

  if (!row) return c.json({ error: 'staff_not_provisioned' }, 403)

  c.set('staffClaims', { sub: payload.sub })
  c.set('staffUserId', row.id)
  c.set('staffRow', row)

  await next()
}

// Kept here for backwards compat — the canonical implementation lives in
// `middleware/require-active.ts`. Existing routes/portal/index.ts imports
// `requireActiveStaff` from this file.
export { requireActiveStaff } from './require-active'
