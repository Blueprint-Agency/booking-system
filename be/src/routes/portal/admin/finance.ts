import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getFinance, financeCsv, UNATTRIBUTED } from '../../../services/finance/list'
import {
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

// Finance: every Money Event in a period — money in and money out — with the
// studio's five figures over it. Replaces the admin Payroll surface; the
// instructor's own Teaching log stays where it is.
// See docs/md/spec-finance.md and docs/adr/0001-finance-replaces-payroll.md.
//
// Shared read/write for superadmin + admin (gated in routes/portal/admin/index.ts).
// Only Instructor Pay and Manual Entries are writable — there is deliberately no
// endpoint that edits a purchase or a Refund, because those are the payment
// provider's record and not ours to restate.
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
  // A Location id, or the Unattributed bucket — the rows that record no Location.
  location: z.union([z.string().uuid(), z.literal(UNATTRIBUTED)]).optional(),
  needs_pay: z.enum(['true', 'false']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})

const patchParam = z.object({
  kind: z.enum(['class', 'pt', 'workshop', 'manual']),
  id: z.string().uuid(),
})
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
  entry_date: isoDate.optional(),
})

/** The failure response for a pay write — one shape for both handlers. */
const saveFailure = (c: Context, kind: PayrollKind, reason: PayrollSaveReason) =>
  c.json({ error: reason, message: payrollSaveMessage(reason, kind) }, payrollSaveStatus[reason])

const filterFrom = (q: z.infer<typeof listQuery>) => ({
  instructorId: q.instructor_id,
  classTypeId: q.class_type_id,
  location: q.location,
  needsPayOnly: q.needs_pay === 'true',
  from: q.from ? new Date(q.from) : undefined,
  to: q.to ? new Date(q.to) : undefined,
})

const app = new Hono()
  // Every Money Event for the filtered period, plus the five tiles and the
  // per-instructor pay breakdown. Tiles cover the WHOLE range, never a page.
  .get('/', zValidator('query', listQuery), async c => {
    const { rows, totals, instructor_totals, unpriced_count } = await getFinance(
      filterFrom(c.req.valid('query')),
    )
    return c.json({ rows, totals, instructor_totals, unpriced_count })
  })
  // The same rows the table got, as a file. Same filters, same read — so the
  // bookkeeper's CSV can never disagree with what the admin was looking at.
  .get('/export', zValidator('query', listQuery), async c => {
    const summary = await getFinance(filterFrom(c.req.valid('query')))
    return c.body(financeCsv(summary), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="finance.csv"',
    })
  })
  // Create a Manual Entry — money owed an instructor that no session accounts
  // for. entry_date defaults to now.
  .post('/manual', zValidator('json', createManualBody), async c => {
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
  .delete('/manual/:id', async c => {
    const id = c.req.param('id')
    const res = await deleteManualPayroll(id)
    if (!res.ok) return saveFailure(c, 'manual', res.reason)
    c.set('auditTarget' as any, { table: 'manual_payroll_entries', id })
    return c.json({ ok: true })
  })
  // Inline edit of one session's Instructor Pay. null clears it back to Unpriced.
  .patch('/pay/:kind/:id', zValidator('param', patchParam), zValidator('json', patchBody), async c => {
    const { kind, id } = c.req.valid('param')
    const { instructor_pay_sgd, instructor_id } = c.req.valid('json')
    const res = await updatePayrollAmount(kind, id, instructor_pay_sgd, instructor_id)
    if (!res.ok) return saveFailure(c, kind, res.reason)
    c.set('auditTarget' as any, { table: payrollAuditTable[kind], id })
    return c.json({ ok: true })
  })

export default app
