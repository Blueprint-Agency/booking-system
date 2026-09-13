import type { Context, MiddlewareHandler, Next } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { clerkStaffApp, verifyStaffToken } from '../lib/clerk'
import { db } from '../db'
import { staffUsers } from '../db/schema/identity'
import { syncStaffFromClerk } from '../services/auth/webhook-sync'
import { logger } from '../shared/logger'
import { captureException } from '../instrument'
import { isPoolSessionToken, readPoolSession } from '../services/auth/better-auth'
import {
  assertTenantOrgClaim,
  assertTenantSessionClaim,
  tenantCorroborated,
  tenantId,
  tenantMatches,
} from './tenant'

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
 * The webhook's sync, driven from a request instead: fetch the Clerk user by
 * the token's subject and run the same link-and-activate the webhook would.
 * Runs inside the request's Tenant context, so it only sees this studio's rows.
 */
async function syncFromClerkUser(clerkUserId: string) {
  const clerkUser = await clerkStaffApp.users.getUser(clerkUserId)
  return syncStaffFromClerk({
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
}

/**
 * The Better Auth half of `clerkStaffAuth`: a `staff` pool session.
 *
 *   401 — no such session in the staff pool (a member's or the super portal's
 *         session is a row this pool has never seen)
 *   403 — the session was signed in on another studio, or this studio has no
 *         staff_users row linked to the user
 *
 * The session claim stands where the organization claim does on the Clerk path,
 * and is checked before the row is read. A staff member of two studios is one
 * user with a row at each, and a session per hostname; this finds the row of the
 * studio the request resolved to, inside its Row-Level Security context, and
 * nothing else. No auto-link: a Better Auth account exists because an invitation
 * made it, and the invitation writes `auth_user_id` itself (#106).
 */
async function staffFromSession(c: Context, next: Next, token: string) {
  const session = await readPoolSession('staff', token)
  if (!session) return c.json({ error: 'invalid_token' }, 401)

  const claimRefusal = assertTenantSessionClaim(c, session.claimedTenantId)
  if (claimRefusal) return c.json({ error: claimRefusal }, 403)

  // Scoped by tenant in the query as well as by the RLS context: this person may
  // hold a row at every studio they work at, and `limit(1)` must not be what
  // decides which one.
  const [row] = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId(c)),
        eq(staffUsers.authUserId, session.userId),
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return c.json({ error: 'staff_not_provisioned' }, 403)
  if (!tenantMatches(c, row.tenantId)) return c.json({ error: 'tenant_mismatch' }, 403)

  c.set('staffUserId', row.id)
  c.set('staffRow', row)
  await next()
}

/**
 * Verifies a staff bearer token — a Better Auth `staff` session
 * (`staffFromSession`) or a Clerk staff JWT — looks up the matching staff_users
 * row, and attaches it to the Hono context. The Clerk half, below:
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
  if (isPoolSessionToken(token)) return staffFromSession(c, next, token)

  let payload: { sub: string; [k: string]: unknown }
  try {
    payload = await verifyStaffToken(token)
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }

  // Organization membership, enforced before the staff row is even read: the
  // token says which studio's portal this person is signed into, and a staff
  // member of one studio reaching another's portal is refused here. The header
  // is not consulted — it was already checked against `Origin`, and this is the
  // half of the check the caller cannot influence at all.
  const orgRefusal = await assertTenantOrgClaim(c, payload)
  if (orgRefusal === 'organization_required') {
    // A token with no organization on it. Usually a staff member whose row is
    // in this studio but whose Clerk user is not yet in its organization — the
    // window between signing up and the webhook granting membership, or a
    // deployment where the webhook never reaches us. The refusal stands (the
    // token really carries no claim), but the sync that grants the membership
    // is run first, so the *next* token the front end mints does. Gated on
    // `Origin` corroboration exactly as the auto-link below is, and for the
    // same reason: it activates a pending row.
    let reason = 'tenant_uncorroborated'
    if (tenantCorroborated(c)) {
      try {
        const repaired = await syncFromClerkUser(payload.sub)
        reason =
          repaired.kind === 'linked' || repaired.kind === 'idempotent'
            ? 'membership_granted'
            : repaired.kind
      } catch (err) {
        logger.error({ err }, 'clerk-staff: organization repair failed')
        captureException(err, { scope: 'clerk-staff-org-repair' })
        reason = 'sync_error'
      }
    }
    return c.json({ error: orgRefusal, reason }, 403)
  }
  if (orgRefusal) return c.json({ error: orgRefusal }, 403)

  let [row] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.clerkUserId, payload.sub), isNull(staffUsers.deletedAt)))
    .limit(1)

  // Auto-link fallback: webhook hasn't fired (e.g. no ngrok in dev) but the
  // signed-in Clerk user matches a pre-seeded/invited staff_users row by email.
  // Same gate as the webhook — only emails already in staff_users get a role,
  // and an expired invitation still refuses (sync returns `invite_expired`).
  //
  // Gated on corroboration for the same reason as the member path: linking
  // *activates* a pending staff row, and doing that on the strength of a header
  // alone lets a signed-in staff member of one studio reach into another's
  // pending invitations by naming it. See tenantCorroborated().
  let syncReason: string | undefined
  if (!row && !tenantCorroborated(c)) {
    syncReason = 'tenant_uncorroborated'
  } else if (!row) {
    try {
      const sync = await syncFromClerkUser(payload.sub)
      if (sync.kind === 'linked' || sync.kind === 'idempotent') {
        ;[row] = await db
          .select()
          .from(staffUsers)
          .where(and(eq(staffUsers.id, sync.staffUserId), isNull(staffUsers.deletedAt)))
          .limit(1)
      } else {
        // no_staff_row | email_mismatch | invite_expired | noop — surface why so
        // a stuck invite is diagnosable from the 403 body and logs.
        syncReason = sync.kind
      }
    } catch (err) {
      logger.error({ err }, 'clerk-staff: auto-link fallback failed')
      captureException(err, { scope: 'clerk-staff-auto-link' })
      syncReason = 'sync_error'
    }
  }

  if (!row) return c.json({ error: 'staff_not_provisioned', reason: syncReason }, 403)

  // Belt to the organization claim's braces. The lookup above already ran
  // inside this tenant's Row-Level Security context, so a row from another
  // studio should be unreachable rather than merely wrong — and this says so
  // out loud instead of trusting that it stays true.
  if (!tenantMatches(c, row.tenantId)) {
    return c.json({ error: 'tenant_mismatch' }, 403)
  }

  c.set('staffClaims', { sub: payload.sub })
  c.set('staffUserId', row.id)
  c.set('staffRow', row)

  await next()
}

// Kept here for backwards compat — the canonical implementation lives in
// `middleware/require-active.ts`. Existing routes/portal/index.ts imports
// `requireActiveStaff` from this file.
export { requireActiveStaff } from './require-active'
