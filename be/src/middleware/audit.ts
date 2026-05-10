import type { MiddlewareHandler } from 'hono'
import { db } from '../db'
import { auditLog } from '../db/schema/ledger'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Writes one audit_log row per successful mutating staff request, after the handler commits.
 * Idempotent reads are not audited. Use `c.set('auditTarget', { table, id })` inside handlers
 * to capture which entity changed; falls back to method+path if not set.
 */
export const audit: MiddlewareHandler = async (c, next) => {
  await next()

  if (!MUTATING.has(c.req.method)) return
  if (c.res.status >= 400) return

  const staffRow = c.get('staffRow')
  if (!staffRow) return

  const target = (c.get('auditTarget' as any) as { table: string; id: string } | undefined) ?? {
    table: c.req.path,
    id: '00000000-0000-0000-0000-000000000000',
  }

  const actorStaffId = c.get('impersonatedBy') ?? staffRow.id
  const payload: Record<string, unknown> = {
    method: c.req.method,
    path: c.req.path,
  }
  const actingAs = c.get('actingAs')
  if (actingAs) payload.actingAs = actingAs

  await db.insert(auditLog).values({
    actorStaffId,
    actorType: 'staff',
    action: `${c.req.method} ${c.req.path}`,
    targetTable: target.table,
    targetId: target.id,
    payload,
  })
}
