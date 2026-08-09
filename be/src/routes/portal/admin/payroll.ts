import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  getPayroll,
  updatePayrollAmount,
  createManualPayroll,
  deleteManualPayroll,
  payrollAuditTable,
  type PayrollKind,
} from '../../../services/payroll/list'
import {
  payrollSaveMessage,
  payrollSaveStatus,
  type PayrollSaveReason,
} from '../../../services/payroll/save-reasons'

// Payroll: completed class + PT sessions with the pay owed to each instructor.
// Shared read/write for superadmin + admin (gated in routes/portal/admin/index.ts).
// See docs/md/be-portal.md §Payroll.
//
// A save that didn't happen answers with its reason; the status comes from
// `payrollSaveStatus` and the sentence from `payrollSaveMessage` — this file
// decides neither. Body shape matches the error boundary's, `{ error, message }`.

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const listQuery = z.object({
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})

const patchParam = z.object({ kind: z.enum(['class', 'pt', 'workshop', 'manual']), id: z.string().uuid() })
const patchBody = z.object({
  instructor_pay_sgd: z.number().min(0).nullable(),
  // Targets a specific instructor's pay row when a session has more than one
  // (main + supporting). Omitted → back-compat: writes the session's own pay
  // column. Required for kind='workshop' (no single default-pay column there).
  instructor_id: z.string().uuid().optional(),
})

const createManualBody = z.object({
  instructor_id: z.string().uuid(),
  amount_sgd: z.number().min(0),
  label: z.string().min(1),
  entry_date: z.string().refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' }).optional(),
})

/** The failure response for a payroll write — one shape for both handlers. */
const saveFailure = (c: Context, kind: PayrollKind, reason: PayrollSaveReason) =>
  c.json({ error: reason, message: payrollSaveMessage(reason, kind) }, payrollSaveStatus[reason])

const app = new Hono()
  // ?instructor_id= ?class_type_id= ?from=ISO ?to=ISO — all optional.
  // Per-instructor totals over the filtered set — the "pay by end of month" view.
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const { rows, totals, unpriced_count } = await getPayroll({
      instructorId: q.instructor_id,
      classTypeId: q.class_type_id,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    })
    return c.json({ rows, totals, unpriced_count })
  })
  // Create an ad-hoc pay line for an instructor (bonus/adjustment/one-off, not
  // tied to a class/PT/workshop). entry_date defaults to now.
  .post('/', zValidator('json', createManualBody), async c => {
    const body = c.req.valid('json')
    const actorStaffId = c.get('staffUserId')
    const row = await createManualPayroll(
      {
        instructorId: body.instructor_id,
        amountSgd: body.amount_sgd,
        label: body.label,
        entryDate: body.entry_date ? new Date(body.entry_date) : new Date(),
      },
      actorStaffId,
    )
    c.set('auditTarget' as any, { table: 'manual_payroll_entries', id: row.id })
    return c.json({ id: row.id }, 201)
  })
  // Remove a stray manual pay line.
  .delete('/manual/:id', async c => {
    const id = c.req.param('id')
    const res = await deleteManualPayroll(id)
    if (!res.ok) return saveFailure(c, 'manual', res.reason)
    c.set('auditTarget' as any, { table: 'manual_payroll_entries', id })
    return c.json({ ok: true })
  })
  // Inline edit of one session's pay (from the payroll table). null clears it.
  .patch('/:kind/:id', zValidator('param', patchParam), zValidator('json', patchBody), async c => {
    const { kind, id } = c.req.valid('param')
    const { instructor_pay_sgd, instructor_id } = c.req.valid('json')
    const res = await updatePayrollAmount(kind, id, instructor_pay_sgd, instructor_id)
    if (!res.ok) return saveFailure(c, kind, res.reason)
    c.set('auditTarget' as any, { table: payrollAuditTable[kind], id })
    return c.json({ ok: true })
  })

export default app
