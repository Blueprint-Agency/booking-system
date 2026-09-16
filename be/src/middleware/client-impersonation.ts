import type { MiddlewareHandler } from 'hono'
import { verifyGrant } from '../lib/impersonation-grant'
import { ERROR_CODES } from '../shared/error-codes'
import { tenantId } from './tenant'

/**
 * On client routes (/api/v1/me/*), pairs an impersonation session with its
 * x-impersonation-grant header (#118).
 *
 *   - Neither a grant nor an impersonation session → no-op (normal request).
 *   - An impersonation session with no valid grant → 401. The grant is what
 *     names the admin on every call; without it their calls would pass as
 *     the member's own. The two live exactly as long as each other.
 *   - A grant on a request not signed in through an impersonation session → 401.
 *   - Grant sub ≠ the session's user → 401 (tampering or a cross-wired session;
 *     never silent).
 *   - Grant minted in another tenant → 401. A grant turns a request into "a
 *     an admin acting as this member", so one minted at one studio and
 *     presented at another would be impersonation across the isolation boundary.
 *   - Everything matches → sets `impersonatedBy` (the admin's
 *     `staff_users.id`, from the grant) + `impersonatedClientId` (the member's
 *     clients row).
 *
 * Must run AFTER clientAuth, which sets `clientSession`.
 */
export const clientImpersonation: MiddlewareHandler = async (c, next) => {
  const session = c.get('clientSession')
  if (!session) return next()

  const header = c.req.header('x-impersonation-grant')
  if (!header && !session.impersonatedBy) return next()

  const grant = header ? verifyGrant(header) : null
  if (!grant || !session.impersonatedBy) {
    return c.json({ error: ERROR_CODES.impersonation_grant_mismatch }, 401)
  }

  if (grant.sub !== session.userId) {
    return c.json({ error: ERROR_CODES.impersonation_subject_mismatch }, 401)
  }

  if (grant.tid !== tenantId(c)) {
    return c.json({ error: ERROR_CODES.impersonation_tenant_mismatch }, 401)
  }

  c.set('impersonatedBy', grant.sas)
  c.set('impersonatedClientId', c.get('clientId'))
  await next()
}
