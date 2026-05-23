import type { MiddlewareHandler } from 'hono'
import { verifyGrant } from '../lib/impersonation-grant'

/**
 * On client routes (/api/v1/me/*), recognises an x-impersonation-grant header.
 *
 *   - Header absent → no-op (normal client request).
 *   - Grant invalid/expired → no-op (graceful — a stale tab shouldn't 4xx).
 *   - Grant valid but sub ≠ authenticated client → 401 (subject mismatch is
 *     either tampering or a cross-wired session; never silent).
 *   - Grant valid + matches → sets `impersonatedBy` + `impersonatedClientId`.
 *
 * Must run AFTER clerkClientAuth (which sets `clerkClaims` with `sub` = the
 * client's Clerk user id). We compare grant.sub against `clerkClaims.sub`.
 */
export const clientImpersonation: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('x-impersonation-grant')
  if (!header) return next()

  const grant = verifyGrant(header)
  if (!grant) return next()

  // The client's Clerk user id, set by clerkClientAuth.
  const authedClerkUserId = c.get('clerkClaims')?.sub
  if (!authedClerkUserId) return next()

  if (grant.sub !== authedClerkUserId) {
    return c.json({ error: 'impersonation_subject_mismatch' }, 401)
  }

  c.set('impersonatedBy', grant.sas)
  c.set('impersonatedClientId', grant.sub)
  await next()
}
