import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { listPayroll, type PayrollRow } from '../../../services/payroll/list'

/**
 * Instructor payroll — the caller's OWN teaching log only.
 *
 * instructor_id is forced to the acting instructor and is never read from the
 * query, so an instructor can never see another instructor's pay. Read-only:
 * pay amounts are set by admins (no PATCH here). See the payroll design — pay is
 * a teaching log; rates/statements/payouts are external.
 */

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const listQuery = z.object({
  class_type_id: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})

function serialize(r: PayrollRow) {
  return {
    kind: r.kind,
    id: r.id,
    instructor_id: r.instructorId,
    instructor_name: r.instructorName,
    class_type_id: r.classTypeId,
    label: r.label,
    session_type: r.sessionType,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    duration_minutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000),
    instructor_pay_sgd: r.instructorPaySgd == null ? null : Number(r.instructorPaySgd),
  }
}

const app = new Hono().get('/', zValidator('query', listQuery), async c => {
  const self = c.get('staffUserId')
  const q = c.req.valid('query')
  const rows = await listPayroll({
    instructorId: self, // forced — never from the query
    classTypeId: q.class_type_id,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  })

  let totalSgd = 0
  let unpricedCount = 0
  for (const r of rows) {
    if (r.instructorPaySgd == null) unpricedCount += 1
    else totalSgd += Number(r.instructorPaySgd)
  }

  return c.json({
    rows: rows.map(serialize),
    total_sgd: totalSgd,
    session_count: rows.length,
    unpriced_count: unpricedCount,
  })
})

export default app
