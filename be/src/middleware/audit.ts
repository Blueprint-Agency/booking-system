import type { MiddlewareHandler } from 'hono'
import { db } from '../db'
import { auditLog } from '../db/schema/ledger'
import { tenantId } from './tenant'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Writes one audit_log row per successful mutating request, after the handler commits.
 *
 *   - Staff request: actor = staffRow.id (or impersonatedBy override for staff→staff impersonation).
 *   - Client request during impersonation: actor = impersonatedBy (the admin's staff id);
 *     payload.impersonatedClientId records who was being impersonated.
 *   - Normal client request (no impersonation): no row written.
 *
 * Idempotent reads are not audited. Use `c.set('auditTarget', { table, id })` inside handlers
 * to capture which entity changed; falls back to method+path if not set. `c.set('auditDetail',
 * { … })` adds what else the row should record, as `payload.detail`. A handler whose
 * service files the action's own audit row, naming the staff member, sets
 * `c.set('auditFiled', true)` so the request is recorded once, not twice.
 */
export const audit: MiddlewareHandler = async (c, next) => {
  await next()

  if (!MUTATING.has(c.req.method)) return
  if (c.res.status >= 400) return
  if (c.get('auditFiled' as any) === true) return

  const staffRow = c.get('staffRow')
  const impersonatedBy = c.get('impersonatedBy')
  const impersonatedClientId = c.get('impersonatedClientId')

  // Determine the actor staff id. Either:
  //  - Staff request (with optional staff→staff impersonation): use impersonatedBy ?? staffRow.id
  //  - Client request being impersonated by an admin: use impersonatedBy
  //  - Anything else (e.g. normal client mutation): skip
  let actorStaffId: string | undefined
  if (staffRow) {
    actorStaffId = impersonatedBy ?? staffRow.id
  } else if (impersonatedBy) {
    actorStaffId = impersonatedBy
  }
  if (!actorStaffId) return

  // A handler whose path names someone who must not be named afterwards — a
  // permanently deleted member (#144) — records the route pattern instead.
  const path = (c.get('auditPath' as any) as string | undefined) ?? c.req.path
  const target = (c.get('auditTarget' as any) as { table: string; id: string } | undefined) ?? {
    table: path,
    id: '00000000-0000-0000-0000-000000000000',
  }

  const payload: Record<string, unknown> = {
    method: c.req.method,
    path,
  }
  const actingAs = c.get('actingAs')
  if (actingAs) payload.actingAs = actingAs
  // What the handler wants remembered about how it was done — an override
  // staff gave after a warning, say (`{ allow_clash: true }`).
  const detail = c.get('auditDetail' as any) as Record<string, unknown> | undefined
  if (detail) payload.detail = detail
  if (impersonatedClientId) payload.impersonatedClientId = impersonatedClientId

  await db.insert(auditLog).values({
    // Stamped rather than left to the column default: the audit trail is one of
    // the things a studio is most entitled to have to itself, and a row that
    // took the default would file every other tenant's actions under this one.
    tenantId: tenantId(c),
    actorStaffId,
    actorType: 'staff',
    action: `${c.req.method} ${path}`,
    targetTable: target.table,
    targetId: target.id,
    payload,
  })
}
