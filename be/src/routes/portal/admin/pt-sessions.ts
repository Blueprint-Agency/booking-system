import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  listPtRequestsForAdmin,
  getPtRequestForAdmin,
  type AdminPtRequestView,
} from '../../../services/pt-sessions/list'
import { linkPtRequestPartner } from '../../../services/pt-sessions/request'
import { tenantId } from '../../../middleware/tenant'
import { ERROR_CODES } from '../../../shared/error-codes'
import { schedulePtRequest, updatePtSession } from '../../../services/pt-sessions/schedule'
import { statusForScheduleError } from '../pt-schedule-status'
import { ptCancelNote } from '../pt-cancel-note'
import { cancelPtRequest } from '../../../services/pt-sessions/cancel'
import { getPtSessionDetail, type PtSessionDetail } from '../../../services/schedule/detail'
import {
  addManualPtSessionMember,
  createManualPtSession,
  listSeatCandidates,
  removeManualPtSessionMember,
} from '../../../services/pt-sessions/manual'
import {
  addedMemberJson,
  addManualMemberFields,
  addManualMemberSchema,
  adminManualSessionSchema,
  adminSeatCandidatesQuery,
  manualSessionFields,
  removedMemberJson,
  removeMemberParam,
  seatCandidatesJson,
} from '../pt-manual'

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
    // Optional: blank leaves the session Unpriced — see the note on the admin
    // class-create schema in ./schedule.ts.
    instructor_pay_sgd: z.number().min(0).nullable().optional(),
    // To the member, when the time is not one they proposed.
    note: z.string().max(500).nullable().optional(),
    // "Schedule anyway" after `time_clash`: a member holds a booking then.
    allow_clash: z.boolean().optional(),
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
  // A manual session's upgrade only (#335): the partner pays their own seat,
  // from this package or else the Default payer, and `override` is "Add anyway".
  co_client_package_id: z.string().uuid().optional(),
  override: z.boolean().optional(),
  // "Save anyway" after `time_clash`: moved, or joined by the partner, the
  // session overlaps a booking someone on it already holds.
  allow_clash: z.boolean().optional(),
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
    schedule_note: r.scheduleNote,
    cancel_note: r.cancelNote,
    // `portal` marks a manual session staff created (#334).
    origin: r.origin,
    created_at: r.createdAt.toISOString(),
    expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    refund_outcome: r.refundOutcome,
    client: r.client,
    class_type: r.classType,
    location: r.location,
    co_client: r.coClient,
    // Shown on every pending request so an admin can route it — and fed back
    // as the schedule dialog's pre-selected instructor.
    bound_instructor: r.boundInstructor,
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

const app = new Hono()
  // ?status=pending|scheduled|cancelled_*|attended|all (default pending), ?location_id=
  .get('/', zValidator('query', listQuery), async c => {
    const { status, location_id } = c.req.valid('query')
    const rows = await listPtRequestsForAdmin(tenantId(c), {
      ...(status === 'all' ? {} : { status }),
      ...(location_id ? { locationIds: [location_id] } : {}),
    })
    return c.json({ pt_requests: rows.map(serialize) })
  })
  // The member's PT packages read against a session's type and instructor —
  // what a manual session's Pay with select lists (#337). Before `/:id`, which
  // would otherwise take the path for an id.
  .get('/seat-candidates', zValidator('query', adminSeatCandidatesQuery), async c => {
    const q = c.req.valid('query')
    const res = await listSeatCandidates(tenantId(c), {
      clientId: q.client_id,
      sessionType: q.session_type,
      instructorId: q.instructor_id,
      actorIsAdmin: true,
    })
    return c.json(seatCandidatesJson(res))
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const row = await getPtRequestForAdmin(tenantId(c), c.req.valid('param').id)
    if (!row) return c.json({ error: ERROR_CODES.not_found }, 404)
    return c.json({ pt_request: serialize(row) })
  })
  // Schedule a pending request → creates pt_session + bookings, flips to scheduled.
  .post('/:id/schedule', zValidator('param', idParam), zValidator('json', scheduleSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId') as string
    const result = await schedulePtRequest(tenantId(c), {
      ptRequestId: id,
      instructorId: body.instructor_id,
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      instructorPaySgd: body.instructor_pay_sgd ?? null,
      note: body.note ?? null,
      actorStaffId: actor,
      // The dialog pre-selects the Bound Instructor, but an admin may override
      // it for one session — a bound coach's illness must not block a member.
      actorIsAdmin: true,
      allowClash: body.allow_clash === true,
    })
    if (!result.ok) return c.json({ error: result.error }, statusForScheduleError(result.error))
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    if (body.allow_clash) c.set('auditDetail' as any, { allow_clash: true })
    const row = await getPtRequestForAdmin(tenantId(c), id)
    return c.json({ pt_request: row ? serialize(row) : null }, 201)
  })
  // A manual session (#334): no member request, so the portal writes one
  // itself and schedules it, seating each named member on their own package.
  .post('/manual', zValidator('json', adminManualSessionSchema), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId') as string
    const { ptRequestId } = await createManualPtSession(tenantId(c), {
      ...manualSessionFields(body),
      instructorId: body.instructor_id,
      actorStaffId: actor,
      actorIsAdmin: true,
    })
    c.set('auditTarget' as any, { table: 'pt_requests', id: ptRequestId })
    if (body.allow_clash) c.set('auditDetail' as any, { allow_clash: true })
    const row = await getPtRequestForAdmin(tenantId(c), ptRequestId)
    return c.json({ pt_request: row ? serialize(row) : null }, 201)
  })
  // Edit/reschedule a SCHEDULED session. :id here is the pt_session id — kept under
  // /sessions/:id (distinct from the pt_request :id used by the routes above) so the
  // same path template never resolves to two different entities across verbs.
  .patch('/sessions/:id', zValidator('param', idParam), zValidator('json', updateSessionSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    await updatePtSession(tenantId(c), id, {
      ...(body.instructor_id !== undefined ? { instructorId: body.instructor_id } : {}),
      ...(body.location_id !== undefined ? { locationId: body.location_id } : {}),
      ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
      ...(body.starts_at !== undefined ? { startsAt: new Date(body.starts_at) } : {}),
      ...(body.ends_at !== undefined ? { endsAt: new Date(body.ends_at) } : {}),
      ...(body.session_type !== undefined ? { sessionType: body.session_type } : {}),
      ...(body.co_client_id !== undefined ? { partnerClientId: body.co_client_id } : {}),
      ...(body.co_client_package_id !== undefined ? { partnerClientPackageId: body.co_client_package_id } : {}),
      override: body.override === true,
      allowClash: body.allow_clash === true,
      actorStaffId: c.get('staffUserId') as string,
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
    if (body.allow_clash) c.set('auditDetail' as any, { allow_clash: true })
    const detail = await getPtSessionDetail(tenantId(c), id)
    return c.json(serializeSession(detail))
  })
  // One more member on a manual session (#337): :id is the pt_session id. The
  // same seat rule and `override` as creating it.
  .post(
    '/sessions/:id/members',
    zValidator('param', idParam),
    zValidator('json', addManualMemberSchema),
    async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const seat = await addManualPtSessionMember(tenantId(c), {
        ...addManualMemberFields(body),
        ptSessionId: id,
        actorStaffId: c.get('staffUserId') as string,
        actorIsAdmin: true,
      })
      c.set('auditTarget' as any, { table: 'bookings', id: seat.bookingId })
      if (body.allow_clash) c.set('auditDetail' as any, { allow_clash: true })
      return c.json(addedMemberJson(body.client_id, seat), 201)
    },
  )
  // One member off a manual session (#335), refunded on their own package;
  // the others stay seated.
  .delete('/sessions/:id/members/:clientId', zValidator('param', removeMemberParam), async c => {
    const { id, clientId } = c.req.valid('param')
    const res = await removeManualPtSessionMember(tenantId(c), {
      ptSessionId: id,
      clientId,
      actorStaffId: c.get('staffUserId') as string,
      source: 'admin',
    })
    c.set('auditTarget' as any, { table: 'pt_sessions', id })
    return c.json(removedMemberJson(res))
  })
  .post('/:id/link-partner', zValidator('param', idParam), zValidator('json', linkPartnerSchema), async c => {
    const { id } = c.req.valid('param')
    const { client_id, email } = c.req.valid('json')
    await linkPtRequestPartner({
      tenantId: tenantId(c),
      ptRequestId: id,
      coClientId: client_id,
      email,
    })
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(tenantId(c), id)
    return c.json({ pt_request: row ? serialize(row) : null })
  })
  // Branches on status: pending → cancelled_before_scheduled (refund);
  // scheduled → cancelled_after_scheduled (cascade; admin = always full refund).
  .post('/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const note = await ptCancelNote(c)
    const actor = c.get('staffUserId') as string
    const result = await cancelPtRequest(tenantId(c), {
      ptRequestId: id,
      source: 'admin',
      actorStaffId: actor,
      note,
    })
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(tenantId(c), id)
    return c.json({ pt_request: row ? serialize(row) : null, result })
  })

export default app
