import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getPayroll } from '../../../services/payroll/list'

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

// Same payroll call the admin screen makes, scoped to one instructor — so the
// two screens can't disagree. This shape is the flat slice of it.
const app = new Hono().get('/', zValidator('query', listQuery), async c => {
  const self = c.get('staffUserId')
  const q = c.req.valid('query')
  const { rows, total_sgd, session_count, unpriced_count } = await getPayroll({
    instructorId: self, // forced — never from the query
    classTypeId: q.class_type_id,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  })
  return c.json({ rows, total_sgd, session_count, unpriced_count })
})

export default app
