import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  listPtRequestsForAdmin,
  getPtRequestForAdmin,
  type AdminPtRequestView,
} from '../../../services/pt-sessions/list'
import { schedulePtRequest, type SchedulePtRequestError } from '../../../services/pt-sessions/schedule'
import { cancelPtRequest } from '../../../services/pt-sessions/cancel'

// PT request triage for admins. No "approve"/"decline" in the simplified flow —
// admin negotiates over WhatsApp, then either schedules (the implicit approval)
// or cancels. See docs/md/be-portal.md §3c.

const isoDate = z.string().refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })
const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  status: z
    .enum(['pending', 'scheduled', 'cancelled_before_scheduled', 'cancelled_after_scheduled', 'attended', 'all'])
    .default('pending'),
  location_id: z.string().uuid().optional(),
})

const scheduleSchema = z
  .object({
    instructor_id: z.string().uuid(),
    location_id: z.string().uuid(),
    room_id: z.string().uuid(),
    starts_at: isoDate,
    ends_at: isoDate,
    instructor_pay_sgd: z.number().min(0).optional(),
  })
  .refine(v => new Date(v.ends_at) > new Date(v.starts_at), {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  })

function serialize(r: AdminPtRequestView) {
  return {
    id: r.id,
    status: r.status,
    session_type: r.sessionType,
    message: r.message,
    created_at: r.createdAt.toISOString(),
    expires_at: r.expiresAt.toISOString(),
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    client: r.client,
    class_type: r.classType,
    location: r.location,
    co_client: r.coClient,
    slots: r.slots.map(s => ({ proposed_date: s.proposedDate, start_time: s.startTime, end_time: s.endTime })),
    session: r.session
      ? {
          id: r.session.id,
          starts_at: r.session.startsAt.toISOString(),
          ends_at: r.session.endsAt.toISOString(),
          instructor_name: r.session.instructorName,
          room_name: r.session.roomName,
        }
      : null,
  }
}

function statusForScheduleError(error: SchedulePtRequestError): 400 | 404 | 409 | 422 {
  switch (error) {
    case 'request_not_found':
      return 404
    case 'not_pending':
    case 'room_conflict':
    case 'instructor_conflict':
      return 409
    case 'partner_account_required':
      return 422
    case 'bad_time_range':
      return 400
  }
}

const app = new Hono()
  // ?status=pending|scheduled|cancelled_*|attended|all (default pending), ?location_id=
  .get('/', zValidator('query', listQuery), async c => {
    const { status, location_id } = c.req.valid('query')
    const rows = await listPtRequestsForAdmin({
      ...(status === 'all' ? {} : { status }),
      ...(location_id ? { locationIds: [location_id] } : {}),
    })
    return c.json({ pt_requests: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const row = await getPtRequestForAdmin(c.req.valid('param').id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({ pt_request: serialize(row) })
  })
  // Schedule a pending request → creates pt_session + bookings, flips to scheduled.
  .post('/:id/schedule', zValidator('param', idParam), zValidator('json', scheduleSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId') as string
    const result = await schedulePtRequest({
      ptRequestId: id,
      instructorId: body.instructor_id,
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      instructorPaySgd: body.instructor_pay_sgd ?? null,
      actorStaffId: actor,
    })
    if (!result.ok) return c.json({ error: result.error }, statusForScheduleError(result.error))
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(id)
    return c.json({ pt_request: row ? serialize(row) : null }, 201)
  })
  // Branches on status: pending → cancelled_before_scheduled (refund);
  // scheduled → cancelled_after_scheduled (cascade; admin = always full refund).
  .post('/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId') as string
    const result = await cancelPtRequest({ ptRequestId: id, source: 'admin', actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(id)
    return c.json({ pt_request: row ? serialize(row) : null, result })
  })

export default app
