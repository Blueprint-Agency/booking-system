import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  listPtRequestsForAdmin,
  getPtRequestForAdmin,
  type AdminPtRequestView,
} from '../../../services/pt-sessions/list'
import { linkPtRequestPartner } from '../../../services/pt-sessions/request'
import {
  schedulePtRequest,
  updatePtSession,
  type SchedulePtRequestError,
} from '../../../services/pt-sessions/schedule'
import { cancelPtRequest } from '../../../services/pt-sessions/cancel'
import { getPtSessionDetail, type PtSessionDetail } from '../../../services/schedule/detail'

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
    // Required on the ADMIN path only — see the note on the admin class-create
    // schema in ./schedule.ts.
    instructor_pay_sgd: z.number().min(0),
  })
  .refine(v => new Date(v.ends_at) > new Date(v.starts_at), {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  })

// PATCH /sessions/:id targets a SCHEDULED pt_sessions row (distinct from the pt_requests
// id used by the routes above) — the only id space with starts_at/room/etc.
const updateSessionSchema = z.object({
  starts_at: isoDate.optional(),
  ends_at: isoDate.optional(),
  room_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  session_type: z.enum(['1on1', '2on1']).optional(),
  // Partner for a 1on1 → 2on1 upgrade. Only needed when the request doesn't
  // already carry a co-client. See services/pt-sessions/schedule.ts.
  co_client_id: z.string().uuid().optional(),
  instructor_id: z.string().uuid().optional(),
  instructor_pay_sgd: z.number().min(0).nullable().optional(),
  supporting_instructors: z
    .array(
      z.object({
        instructor_id: z.string().uuid(),
        pay_sgd: z.number().min(0).nullable().optional(),
      }),
    )
    .optional(),
})

const linkPartnerSchema = z
  .object({
    client_id: z.string().uuid().optional(),
    email: z.string().email().optional(),
  })
  .refine(v => Boolean(v.client_id || v.email), {
    message: 'client_id_or_email_required',
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
    refund_outcome: r.refundOutcome,
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

function serializeSession(d: PtSessionDetail) {
  return {
    id: d.id,
    pt_request_id: d.ptRequestId,
    lifecycle: d.lifecycle,
    starts_at: d.startsAt.toISOString(),
    ends_at: d.endsAt.toISOString(),
    session_type: d.sessionType,
    instructor: d.instructor,
    main_instructor_id: d.mainInstructorId,
    instructor_pay_sgd: d.instructorPaySgd,
    supporting_instructor_ids: d.supportingInstructorIds,
    supporting_instructors: d.supportingInstructors,
    instructor_ids: [d.mainInstructorId, ...d.supportingInstructorIds],
    location: d.location,
    room: d.room,
    capacity_online: d.capacityOnline,
    capacity_waitlist: d.capacityWaitlist,
    capacity_buffer: d.capacityBuffer,
  }
}

function statusForScheduleError(error: SchedulePtRequestError): 400 | 404 | 409 | 422 {
  switch (error) {
    case 'request_not_found':
      return 404
    case 'not_pending':
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
  // Edit/reschedule a SCHEDULED session. :id here is the pt_session id — kept under
  // /sessions/:id (distinct from the pt_request :id used by the routes above) so the
  // same path template never resolves to two different entities across verbs.
  .patch('/sessions/:id', zValidator('param', idParam), zValidator('json', updateSessionSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    await updatePtSession(id, {
      ...(body.instructor_id !== undefined ? { instructorId: body.instructor_id } : {}),
      ...(body.location_id !== undefined ? { locationId: body.location_id } : {}),
      ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
      ...(body.starts_at !== undefined ? { startsAt: new Date(body.starts_at) } : {}),
      ...(body.ends_at !== undefined ? { endsAt: new Date(body.ends_at) } : {}),
      ...(body.session_type !== undefined ? { sessionType: body.session_type } : {}),
      ...(body.co_client_id !== undefined ? { partnerClientId: body.co_client_id } : {}),
      ...(body.instructor_pay_sgd !== undefined ? { instructorPaySgd: body.instructor_pay_sgd } : {}),
      // snake_case → the roster module's shape, and nothing else. An OMITTED
      // `pay_sgd` stays omitted (the roster keeps whatever is recorded); an
      // explicit `null` stays null (unpriced). See services/schedule/roster-merge.ts.
      ...(body.supporting_instructors !== undefined
        ? {
            supportingInstructors: body.supporting_instructors.map(s => ({
              instructorId: s.instructor_id,
              ...(s.pay_sgd !== undefined ? { paySgd: s.pay_sgd } : {}),
            })),
          }
        : {}),
    })
    c.set('auditTarget' as any, { table: 'pt_sessions', id })
    const detail = await getPtSessionDetail(id)
    return c.json(serializeSession(detail))
  })
  .post('/:id/link-partner', zValidator('param', idParam), zValidator('json', linkPartnerSchema), async c => {
    const { id } = c.req.valid('param')
    const { client_id, email } = c.req.valid('json')
    await linkPtRequestPartner({ ptRequestId: id, coClientId: client_id, email })
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(id)
    return c.json({ pt_request: row ? serialize(row) : null })
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
