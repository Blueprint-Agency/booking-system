import type { MiddlewareHandler } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { clients } from '../db/schema/identity'
import { readPoolSession, type PoolSession } from '../services/auth/better-auth'
import { assertTenantSessionClaim, tenantId, tenantMatches } from './tenant'

declare module 'hono' {
  interface ContextVariableMap {
    /** The member's Better Auth session. */
    clientSession: PoolSession
    clientId: string
    clientRow: typeof clients.$inferSelect
  }
}

/**
 * Verifies a member bearer token — a Better Auth `client` pool session — and
 * attaches the member's `clients` row at this studio.
 *
 *   401 — no bearer token, or no such session in the client pool (a staff or
 *         super portal session is a row this pool has never seen)
 *   403 — the session was signed in on another studio
 *   404 — this studio has no clients row linked to the user
 *
 * The session carries the Tenant it was signed in on, so a member of studio A
 * who names studio B is refused here, before any row is read — not merely fenced
 * by Row-Level Security. No auto-provision: member registration writes the
 * clients row alongside the auth user. `clientSession` is what
 * `clientImpersonation` compares an impersonation grant against.
 */
export const clientAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_bearer_token' }, 401)
  }
  const token = header.slice(7).trim()
  if (!token) {
    return c.json({ error: 'missing_bearer_token' }, 401)
  }

  const session = await readPoolSession('client', token)
  if (!session) return c.json({ error: 'invalid_token' }, 401)

  const claimRefusal = assertTenantSessionClaim(c, session.claimedTenantId)
  if (claimRefusal) return c.json({ error: claimRefusal }, 403)

  // Tenant in the query as well as in the RLS context: the same person may hold
  // a row at another studio, and it is not this one.
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId(c)), eq(clients.authUserId, session.userId)))
    .limit(1)
  if (!row) return c.json({ error: 'client_not_found' }, 404)
  if (!tenantMatches(c, row.tenantId)) return c.json({ error: 'tenant_mismatch' }, 403)

  c.set('clientSession', session)
  c.set('clientId', row.id)
  c.set('clientRow', row)
  await next()
}

export const requireActiveClient: MiddlewareHandler = async (c, next) => {
  const row = c.get('clientRow')
  // Blocking sets deleted_at and ends the member's sessions; a session that
  // outlived that (or a status flipped by hand) is still refused here.
  if (row.deletedAt || row.status !== 'active') {
    return c.json({ error: 'client_blocked' }, 403)
  }
  await next()
}
