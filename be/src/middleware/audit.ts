import type { MiddlewareHandler } from 'hono'
import { db } from '../db'
import { auditLog } from '../db/schema/ledger'
import { tenantId } from './tenant'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Writes one audit_log row per successful mutating request, after the handler commits.
 *
 *   - Staff request: actor = staffRow.id (or impersonatedBy override for staff→staff impersonation).
 *   - Client request during impersonation: actor = impersonatedBy (the superadmin's staff id);
 *     payload.impersonatedClientId records who was being impersonated.
 *   - Normal client request (no impersonation): no row written.
 *
 * Idempotent reads are not audited. Use `c.set('auditTarget', { table, id })` inside handlers
 * to capture which entity changed; falls back to method+path if not set.
 */
export const audit: MiddlewareHandler = async (c, next) => {
  await next()

  if (!MUTATING.has(c.req.method)) return
  if (c.res.status >= 400) return

  const staffRow = c.get('staffRow')
  const impersonatedBy = c.get('impersonatedBy')
  const impersonatedClientId = c.get('impersonatedClientId')

  // Determine the actor staff id. Either:
  //  - Staff request (with optional staff→staff impersonation): use impersonatedBy ?? staffRow.id
  //  - Client request being impersonated by a superadmin: use impersonatedBy
  //  - Anything else (e.g. normal client mutation): skip
  let actorStaffId: string | undefined
  if (staffRow) {
    actorStaffId = impersonatedBy ?? staffRow.id
  } else if (impersonatedBy) {
    actorStaffId = impersonatedBy
  }
  if (!actorStaffId) return

  const target = (c.get('auditTarget' as any) as { table: string; id: string } | undefined) ?? {
    table: c.req.path,
    id: '00000000-0000-0000-0000-000000000000',
  }

  const payload: Record<string, unknown> = {
    method: c.req.method,
    path: c.req.path,
  }
  const actingAs = c.get('actingAs')
  if (actingAs) payload.actingAs = actingAs
  if (impersonatedClientId) payload.impersonatedClientId = impersonatedClientId

  await db.insert(auditLog).values({
    // Stamped rather than left to the column default: the audit trail is one of
    // the things a studio is most entitled to have to itself, and a row that
    // took the default would file every other tenant's actions under this one.
    tenantId: tenantId(c),
    actorStaffId,
    actorType: 'staff',
    action: `${c.req.method} ${c.req.path}`,
    targetTable: target.table,
    targetId: target.id,
    payload,
  })
}
