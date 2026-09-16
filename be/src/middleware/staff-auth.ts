import type { MiddlewareHandler } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { staffUsers } from '../db/schema/identity'
import { readPoolSession } from '../services/auth/better-auth'
import { ERROR_CODES } from '../shared/error-codes'
import { setLogContext } from '../shared/logger'
import { assertTenantSessionClaim, tenantId, tenantMatches } from './tenant'

declare module 'hono' {
  interface ContextVariableMap {
    staffUserId: string
    staffRow: typeof staffUsers.$inferSelect
    actingAs?: string
    impersonatedBy?: string
    impersonatedClientId?: string
  }
}

/**
 * Verifies a staff bearer token — a Better Auth `staff` pool session — looks up
 * the matching `staff_users` row, and attaches it to the Hono context.
 *
 *   401 — no bearer token, or no such session in the staff pool (a member's or
 *         the super portal's session is a row this pool has never seen)
 *   403 — the session was signed in on another studio, or this studio has no
 *         staff_users row linked to the user
 *
 * The session's Tenant claim is checked before the row is read. A staff member
 * of two studios is one user with a row at each, and a session per hostname;
 * this finds the row of the studio the request resolved to, inside its
 * Row-Level Security context, and nothing else. No auto-link: an account exists
 * because an invitation or a seed made it, and that wrote `auth_user_id` itself.
 * The active gate is `requireActiveStaff`, separately.
 */
export const staffAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: ERROR_CODES.missing_bearer_token }, 401)
  }
  const token = header.slice(7).trim()
  if (!token) {
    return c.json({ error: ERROR_CODES.missing_bearer_token }, 401)
  }

  const session = await readPoolSession('staff', token)
  if (!session) return c.json({ error: ERROR_CODES.invalid_token }, 401)
  setLogContext({ actorId: session.userId, pool: 'staff' })

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
  if (!row) return c.json({ error: ERROR_CODES.staff_not_provisioned }, 403)

  // Belt to the session claim's braces. The lookup above already ran inside
  // this tenant's Row-Level Security context, so a row from another studio
  // should be unreachable rather than merely wrong — and this says so out loud
  // instead of trusting that it stays true.
  if (!tenantMatches(c, row.tenantId)) return c.json({ error: ERROR_CODES.tenant_mismatch }, 403)

  c.set('staffUserId', row.id)
  c.set('staffRow', row)
  await next()
}
