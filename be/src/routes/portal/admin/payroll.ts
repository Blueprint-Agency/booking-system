import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { listPayroll, updatePayrollAmount, type PayrollRow } from '../../../services/payroll/list'

// Payroll: completed class + PT sessions with the pay owed to each instructor.
// Shared read/write for superadmin + admin (gated in routes/portal/admin/index.ts).
// See docs/md/be-portal.md §Payroll.

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const listQuery = z.object({
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})

const patchParam = z.object({ kind: z.enum(['class', 'pt', 'workshop']), id: z.string().uuid() })
const patchBody = z.object({
  instructor_pay_sgd: z.number().min(0).nullable(),
  // Targets a specific instructor's pay row when a session has more than one
  // (main + supporting). Omitted → back-compat: writes the session's own pay
  // column. Required for kind='workshop' (no single default-pay column there).
  instructor_id: z.string().uuid().optional(),
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

const app = new Hono()
  // ?instructor_id= ?class_type_id= ?from=ISO ?to=ISO — all optional.
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await listPayroll({
      instructorId: q.instructor_id,
      classTypeId: q.class_type_id,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    })

    // Per-instructor totals over the filtered set — the "pay by end of month" view.
    // Only priced rows contribute to total_sgd; unpriced ones are surfaced separately.
    const totalsMap = new Map<
      string,
      { instructor_id: string; instructor_name: string; total_sgd: number; session_count: number }
    >()
    let unpricedCount = 0
    for (const r of rows) {
      const t =
        totalsMap.get(r.instructorId) ??
        { instructor_id: r.instructorId, instructor_name: r.instructorName, total_sgd: 0, session_count: 0 }
      t.session_count += 1
      if (r.instructorPaySgd == null) unpricedCount += 1
      else t.total_sgd += Number(r.instructorPaySgd)
      totalsMap.set(r.instructorId, t)
    }
    const totals = Array.from(totalsMap.values()).sort((a, b) =>
      a.instructor_name.localeCompare(b.instructor_name),
    )

    return c.json({ rows: rows.map(serialize), totals, unpriced_count: unpricedCount })
  })
  // Inline edit of one session's pay (from the payroll table). null clears it.
  .patch('/:kind/:id', zValidator('param', patchParam), zValidator('json', patchBody), async c => {
    const { kind, id } = c.req.valid('param')
    const { instructor_pay_sgd, instructor_id } = c.req.valid('json')
    const res = await updatePayrollAmount(kind, id, instructor_pay_sgd, instructor_id)
    if (!res.ok) return c.json({ error: 'not_found' }, 404)
    const table =
      kind === 'class' ? 'classes' : kind === 'pt' ? 'pt_sessions' : 'workshop_instructors'
    c.set('auditTarget' as any, { table, id })
    return c.json({ ok: true })
  })

export default app
