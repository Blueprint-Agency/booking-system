import type { MiddlewareHandler } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import type { InstructorPermission } from '../db/enums'
import { staffUsers } from '../db/schema/identity'
import { readPoolSession } from '../services/auth/better-auth'
import { resolveInstructorPermissions } from '../services/auth/instructor-permissions'
import { ERROR_CODES } from '../shared/error-codes'
import { setLogContext } from '../shared/logger'
import { assertTenantSessionClaim, tenantId, tenantMatches } from './tenant'

declare module 'hono' {
  interface ContextVariableMap {
    staffUserId: string
    staffRow: typeof staffUsers.$inferSelect
    /**
     * The caller's Instructor Permissions, resolved on this request: every one
     * for an Admin, the profile row's grant for an Instructor. Read by
     * `requirePermission`; never cached across requests, so a revocation is
     * immediate.
     */
    staffPermissions: ReadonlySet<InstructorPermission>
    actingAs?: string
    impersonatedBy?: string
    impersonatedClientId?: string
  }
}

/**
 * Verifies a staff bearer token — a Better Auth `staff` pool session — looks up
 * the matching `staff_users` row, and attaches it to the Hono context.
 *
 *   401 — no bearer token, or no such session in the staff pool at this studio
 *         (a member's or the super portal's session is a row this pool has
 *         never seen, and another studio's is one this studio's context cannot
 *         see, since logins are per studio — #231)
 *   403 — the session's claim names another studio, or this studio has no
 *         staff_users row linked to the user
 *
 * The session's Tenant claim is checked before the row is read. A staff member
 * of two studios has a login and a row at each; this finds the row of the
 * studio the request resolved to, inside its Row-Level Security context, and
 * nothing else. No auto-link: an account exists because an invitation or a
 * seed made it, and that wrote `auth_user_id` itself. The active gate is
 * `requireActiveStaff`, separately.
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

  // Scoped by tenant in the query as well as by the RLS context, so neither is
  // the only thing deciding which studio's row this is.
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
  // Once per request, after the row: what this staff member may do beyond
  // their role (be/docs/adr/0012). An Admin resolves to everything without a
  // read; an Instructor's grant is read fresh so an Admin's change reaches
  // their very next request.
  c.set('staffPermissions', await resolveInstructorPermissions(row))
  await next()
}
