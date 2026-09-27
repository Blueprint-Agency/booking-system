import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  listPtRequestsForAdmin,
  getPtRequestForAdmin,
  type AdminPtRequestView,
} from '../../../services/pt-sessions/list'
import { schedulePtRequest } from '../../../services/pt-sessions/schedule'
import { cancelPtRequest } from '../../../services/pt-sessions/cancel'
import { statusForScheduleError } from '../pt-schedule-status'
import { tenantId } from '../../../middleware/tenant'
import {
  addManualPtSessionMember,
  createManualPtSession,
  listSeatCandidates,
} from '../../../services/pt-sessions/manual'
import {
  addedMemberJson,
  addManualMemberFields,
  addManualMemberSchema,
  instructorManualSessionSchema,
  instructorSeatCandidatesQuery,
  manualSessionFields,
  seatCandidatesJson,
} from '../pt-manual'

// Instructor PT surface. Instructors see the pending requests they may act on —
// unbound ones, plus those bound to them — and pick up the ones they can run;
// the schedule service forces instructor_id = self. A request debited from a
// package bound to someone else is neither listed nor schedulable here. There is
// no approve/decline: scheduling is the implicit approval. See be-portal.md §3c.

const isoDate = z.string().refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })
const idParam = z.object({ id: z.string().uuid() })

// instructor_id is taken from the authenticated staff context, never the body.
const scheduleSchema = z
  .object({
    location_id: z.string().uuid(),
    room_id: z.string().uuid(),
    starts_at: isoDate,
    ends_at: isoDate,
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
    origin: r.origin,
    created_at: r.createdAt.toISOString(),
    expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    refund_outcome: r.refundOutcome,
    client: r.client,
    class_type: r.classType,
    location: r.location,
    co_client: r.coClient,
    // Present only on requests this instructor may take, because the queue
    // filters the rest out — so a non-null value here means "bound to you".
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

const app = new Hono()
  // The pending queue this instructor may act on: unbound requests, plus the
  // ones bound to them. Somebody else's bound request is not work they can
  // pick up, so it is not work they see.
  .get('/', async c => {
    const rows = await listPtRequestsForAdmin(tenantId(c), {
      status: 'pending',
      visibleToInstructorId: c.get('staffUserId') as string,
    })
    return c.json({ pt_requests: rows.map(serialize) })
  })
  // A manual session (#334), run by the caller: the session's instructor is
  // always self, and a member bound to another coach is refused, not warned.
  .post('/manual', zValidator('json', instructorManualSessionSchema), async c => {
    const self = c.get('staffUserId') as string
    const { ptRequestId } = await createManualPtSession(tenantId(c), {
      ...manualSessionFields(c.req.valid('json')),
      instructorId: self,
      actorStaffId: self,
      actorIsAdmin: false,
    })
    c.set('auditTarget' as any, { table: 'pt_requests', id: ptRequestId })
    const row = await getPtRequestForAdmin(tenantId(c), ptRequestId)
    return c.json({ pt_request: row ? serialize(row) : null }, 201)
  })
  // The member's PT packages read against a session the caller would run
  // (#337): the instructor is always self, so a package bound to another
  // coach reads as refused, not warned.
  .get('/seat-candidates', zValidator('query', instructorSeatCandidatesQuery), async c => {
    const q = c.req.valid('query')
    const res = await listSeatCandidates(tenantId(c), {
      clientId: q.client_id,
      sessionType: q.session_type,
      instructorId: c.get('staffUserId') as string, // never from the query
      actorIsAdmin: false,
    })
    return c.json(seatCandidatesJson(res))
  })
  // One more member on a manual session the caller runs (#337); another
  // coach's session is `403 not_your_session`.
  .post(
    '/sessions/:id/members',
    zValidator('param', idParam),
    zValidator('json', addManualMemberSchema),
    async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const self = c.get('staffUserId') as string
      const seat = await addManualPtSessionMember(tenantId(c), {
        ...addManualMemberFields(body),
        ptSessionId: id,
        actorStaffId: self,
        actorIsAdmin: false,
        requireOwnInstructorId: self,
      })
      c.set('auditTarget' as any, { table: 'bookings', id: seat.bookingId })
      return c.json(addedMemberJson(body.client_id, seat), 201)
    },
  )
  .post('/:id/schedule', zValidator('param', idParam), zValidator('json', scheduleSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const self = c.get('staffUserId') as string
    const result = await schedulePtRequest(tenantId(c), {
      ptRequestId: id,
      instructorId: self, // forced to the acting instructor
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      actorStaffId: self,
      // Never the admin bypass: on this surface the binding rule decides, and
      // a request bound to a different instructor is refused.
      actorIsAdmin: false,
    })
    if (!result.ok) return c.json({ error: result.error }, statusForScheduleError(result.error))
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(tenantId(c), id)
    return c.json({ pt_request: row ? serialize(row) : null }, 201)
  })
  .post('/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const self = c.get('staffUserId') as string
    // source:'admin' = staff-initiated (full refund, doesn't count to client cap),
    // but requireOwnInstructorId restricts it to the instructor's own scheduled session.
    const result = await cancelPtRequest(tenantId(c), {
      ptRequestId: id,
      source: 'admin',
      actorStaffId: self,
      requireOwnInstructorId: self,
    })
    c.set('auditTarget' as any, { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(tenantId(c), id)
    return c.json({ pt_request: row ? serialize(row) : null, result })
  })

export default app
