import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/leave/requests'

/**
 * The admin leave queue — read every instructor's requests, and decide them.
 *
 * Approve / reject / revoke are mounted HERE and nowhere else. The instructor
 * subtree (routes/portal/instructor/leave.ts) carries withdraw and cancel and
 * nothing more, so an instructor has no route to decide anything — including his
 * own request. Role gating for this mount (admin + superadmin) sits with the
 * rest in ./index.ts.
 *
 * This is the admin view, so it serialises the restricted fields — leave type,
 * the instructor's reason, the decision reason — which the all-staff calendar
 * must not.
 */

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  status: z
    .enum(['pending', 'approved', 'rejected', 'withdrawn', 'cancelled', 'revoked', 'all'])
    .default('pending'),
})

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(500) })

function serialize(v: svc.AdminLeaveRequest) {
  const r = v.row
  return {
    id: r.id,
    instructor: v.instructor,
    type: r.type,
    start_date: r.startDate,
    end_date: r.endDate,
    half_day: r.halfDay,
    days: Number(r.days),
    leave_year: r.leaveYear,
    status: r.status,
    reason: r.reason,
    decision_reason: r.decisionReason,
    decided_at: r.decidedAt,
    created_at: r.createdAt,
    // Whether there is a Supporting Document, never the key — reading it goes through
    // the signed-URL route below.
    has_supporting_document: r.supportingDocumentR2Key !== null,
  }
}

const app = new Hono()
  // ?status=pending (default) | approved | … | all
  .get('/', zValidator('query', listQuery), async c => {
    const { status } = c.req.valid('query')
    const rows = await svc.listLeaveRequestsForAdmin(status === 'all' ? undefined : status)
    return c.json({ leave_requests: rows.map(serialize) })
  })
  // A short-lived signed GET for the Supporting Document. Same service the
  // instructor's own route calls — an admin caller passes its ownership check,
  // so there is one rule and no second copy of it.
  .get('/:id/document', zValidator('param', idParam), async c =>
    c.json(
      await svc.supportingDocumentUrl(
        svc.leaveViewer(c.get('staffRow')),
        c.req.valid('param').id,
      ),
    ),
  )
  .post('/:id/approve', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.decideLeaveRequest({ action: 'approve', id, actorStaffId: c.get('staffUserId') })
    c.set('auditTarget' as any, { table: 'leave_requests', id })
    return c.json({ ok: true })
  })
  // The reason is required by the schema AND by the service — it is what the
  // instructor is emailed, so it can't be optional at either layer.
  .post('/:id/reject', zValidator('param', idParam), zValidator('json', rejectSchema), async c => {
    const { id } = c.req.valid('param')
    await svc.decideLeaveRequest({
      action: 'reject',
      id,
      actorStaffId: c.get('staffUserId'),
      reason: c.req.valid('json').reason,
    })
    c.set('auditTarget' as any, { table: 'leave_requests', id })
    return c.json({ ok: true })
  })
  // Approved leave that hasn't started. The service refuses anything else.
  .post('/:id/revoke', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.decideLeaveRequest({ action: 'revoke', id, actorStaffId: c.get('staffUserId') })
    c.set('auditTarget' as any, { table: 'leave_requests', id })
    return c.json({ ok: true })
  })

export default app
