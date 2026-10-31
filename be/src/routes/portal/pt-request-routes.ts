import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  getPtRequestForAdmin,
  listPtRequestsForAdmin,
  type AdminPtRequestView,
  type ListPtRequestsForAdminOpts,
} from '../../services/pt-sessions/list'
import { schedulePtRequest } from '../../services/pt-sessions/schedule'
import { cancelPtRequest } from '../../services/pt-sessions/cancel'
import {
  addManualPtSessionMember,
  createManualPtSession,
  listSeatCandidates,
  removeManualPtSessionMember,
} from '../../services/pt-sessions/manual'
import { tenantId } from '../../middleware/tenant'
import { dateTime } from '../../shared/date-time'
import {
  addedMemberJson,
  addManualMemberFields,
  addManualMemberSchema,
  adminManualSessionSchema,
  adminSeatCandidatesQuery,
  instructorManualSessionSchema,
  instructorSeatCandidatesQuery,
  manualSessionFields,
  removedMemberJson,
  removeMemberParam,
  seatCandidatesJson,
} from './pt-manual'
import { ptCancelNote } from './pt-cancel-note'
import { statusForScheduleError } from './pt-schedule-status'
import { type BodyOf, endsAfterStart, endsAfterStartIssue, idParam } from './parse'
import type { Surface } from './surface'

/**
 * A PT Request as the Admin's and the Instructor's private session routes
 * answer it. `bound_instructor` is shown on every pending request the Admin
 * sees, so they can route it, and is fed back as the schedule dialog's
 * pre-selected instructor. The Instructor's queue holds only the requests they
 * may take, so there a non-null value means "bound to you".
 */
export function ptRequestJson(r: AdminPtRequestView) {
  return {
    id: r.id,
    status: r.status,
    session_type: r.sessionType,
    message: r.message,
    schedule_note: r.scheduleNote,
    cancel_note: r.cancelNote,
    // `portal` marks a manual session staff created.
    origin: r.origin,
    created_at: r.createdAt.toISOString(),
    expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    refund_outcome: r.refundOutcome,
    client: r.client,
    class_type: r.classType,
    location: r.location,
    co_client: r.coClient,
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

/**
 * The fields of a schedule body that are the same for both surfaces, in the
 * order a body is read. Each surface's own go around them: the Admin's
 * `instructor_id` opens the body and its pay follows the end time.
 */
const placeAndTime = {
  location_id: z.string().uuid(),
  room_id: z.string().uuid(),
  starts_at: dateTime('A start time'),
  ends_at: dateTime('An end time'),
}
const forTheMember = {
  // To the member, when the time is not one they proposed.
  note: z.string().max(500).nullable().optional(),
  // "Schedule anyway" after `time_clash`: a member holds a booking then.
  allow_clash: z.boolean().optional(),
}

type ScheduleBody = z.infer<z.ZodObject<typeof placeAndTime & typeof forTheMember>>
type ManualBody = z.infer<typeof instructorManualSessionSchema>
type SeatCandidatesQuery = z.infer<typeof instructorSeatCandidatesQuery>

/**
 * What one surface says and is told, for each route the two share. The shared
 * handlers below read it and never branch on the surface themselves.
 */
interface PtSurface<Queue, Schedule extends ScheduleBody, Manual extends ManualBody, Seats extends SeatCandidatesQuery> {
  /** `GET /` — the requests the caller may act on, and the filters their query may name. */
  queue: { query: BodyOf<Queue>; filters: (q: Queue, self: string) => ListPtRequestsForAdminOpts }
  /** `POST /:id/schedule` — who runs the session, and any pay the body may set. */
  schedule: {
    body: BodyOf<Schedule>
    staffing: (b: Schedule, self: string) => { instructorId: string; instructorPaySgd?: number | null }
  }
  /** `POST /manual` — who runs the session. */
  manual: { body: BodyOf<Manual>; instructorId: (b: Manual, self: string) => string }
  /** `GET /seat-candidates` — whose coaching the member's packages are read against. */
  seatCandidates: { query: BodyOf<Seats>; instructorId: (q: Seats, self: string) => string }
  /** What the services are told about the caller. */
  actor: {
    /** Whom a removal or cancel is recorded as. */
    source: 'admin' | 'instructor'
    /** Whether the binding rule is bypassed (an Admin may place a bound package's session with any instructor). */
    actorIsAdmin: boolean
    /** Add member, Remove member and Cancel reach only sessions the caller runs, where the surface says so. */
    ownSessionsOnly: (self: string) => { requireOwnInstructorId?: string }
  }
}

/**
 * The private session routes the Admin and the Instructor share, mounted under
 * `/pt-sessions` and `/pt-requests`. There is no approve or decline: the Admin
 * negotiates over WhatsApp, then either schedules (the implicit approval) or
 * cancels; an Instructor picks up the requests they can run (be-portal.md §3c).
 *
 *   GET    /                                 — the queue
 *   GET    /seat-candidates                  — a member's PT packages read against a session's shape
 *   POST   /manual                           — a session staff create themselves, no request behind it
 *   POST   /:id/schedule                     — schedule a pending request
 *   POST   /:id/cancel                       — cancel a request (a refund; staff's, so it doesn't count to the member's cap)
 *   POST   /sessions/:id/members             — one more member on a manual session
 *   DELETE /sessions/:id/members/:clientId   — one member off it, refunded on their own package
 *
 * Static paths are registered here, before the Admin's `/:id` reads that
 * follow this module on its mount, so a path segment is never taken for a
 * request id.
 */
function ptRequestsFor<
  Queue,
  Schedule extends ScheduleBody,
  Manual extends ManualBody,
  Seats extends SeatCandidatesQuery,
>(spec: PtSurface<Queue, Schedule, Manual, Seats>) {
  return new Hono()
    .get('/', zValidator('query', spec.queue.query), async c => {
      const rows = await listPtRequestsForAdmin(
        tenantId(c),
        spec.queue.filters(c.req.valid('query'), c.get('staffUserId')),
      )
      return c.json({ pt_requests: rows.map(ptRequestJson) })
    })
    .get('/seat-candidates', zValidator('query', spec.seatCandidates.query), async c => {
      const q = c.req.valid('query')
      const res = await listSeatCandidates(tenantId(c), {
        clientId: q.client_id,
        sessionType: q.session_type,
        instructorId: spec.seatCandidates.instructorId(q, c.get('staffUserId')), // never from the query where the surface forces it
        startsAt: q.starts_at ? new Date(q.starts_at) : null,
        actorIsAdmin: spec.actor.actorIsAdmin,
      })
      return c.json(seatCandidatesJson(res))
    })
    .post('/manual', zValidator('json', spec.manual.body), async c => {
      const body = c.req.valid('json')
      const self = c.get('staffUserId')
      const { ptRequestId } = await createManualPtSession(tenantId(c), {
        ...manualSessionFields(body),
        instructorId: spec.manual.instructorId(body, self),
        actorStaffId: self,
        actorIsAdmin: spec.actor.actorIsAdmin,
      })
      c.set('auditTarget', { table: 'pt_requests', id: ptRequestId })
      if (body.allow_clash) c.set('auditDetail', { allow_clash: true })
      const row = await getPtRequestForAdmin(tenantId(c), ptRequestId)
      return c.json({ pt_request: row ? ptRequestJson(row) : null }, 201)
    })
    .post('/:id/schedule', zValidator('param', idParam), zValidator('json', spec.schedule.body), async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const self = c.get('staffUserId')
      const result = await schedulePtRequest(tenantId(c), {
        ptRequestId: id,
        ...spec.schedule.staffing(body, self),
        locationId: body.location_id,
        roomId: body.room_id,
        startsAt: new Date(body.starts_at),
        endsAt: new Date(body.ends_at),
        note: body.note ?? null,
        actorStaffId: self,
        actorIsAdmin: spec.actor.actorIsAdmin,
        allowClash: body.allow_clash === true,
      })
      if (!result.ok) return c.json({ error: result.error }, statusForScheduleError(result.error))
      c.set('auditTarget', { table: 'pt_requests', id })
      if (body.allow_clash) c.set('auditDetail', { allow_clash: true })
      const row = await getPtRequestForAdmin(tenantId(c), id)
      return c.json({ pt_request: row ? ptRequestJson(row) : null }, 201)
    })
    .post('/sessions/:id/members', zValidator('param', idParam), zValidator('json', addManualMemberSchema), async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const self = c.get('staffUserId')
      const seat = await addManualPtSessionMember(tenantId(c), {
        ...addManualMemberFields(body),
        ptSessionId: id,
        actorStaffId: self,
        actorIsAdmin: spec.actor.actorIsAdmin,
        ...spec.actor.ownSessionsOnly(self),
      })
      c.set('auditTarget', { table: 'bookings', id: seat.bookingId })
      if (body.allow_clash) c.set('auditDetail', { allow_clash: true })
      return c.json(addedMemberJson(body.client_id, seat), 201)
    })
    .delete('/sessions/:id/members/:clientId', zValidator('param', removeMemberParam), async c => {
      const { id, clientId } = c.req.valid('param')
      const self = c.get('staffUserId')
      const res = await removeManualPtSessionMember(tenantId(c), {
        ptSessionId: id,
        clientId,
        actorStaffId: self,
        source: spec.actor.source,
        ...spec.actor.ownSessionsOnly(self),
      })
      c.set('auditTarget', { table: 'pt_sessions', id })
      return c.json(removedMemberJson(res))
    })
    .post('/:id/cancel', zValidator('param', idParam), async c => {
      const { id } = c.req.valid('param')
      const note = await ptCancelNote(c)
      const self = c.get('staffUserId')
      const result = await cancelPtRequest(tenantId(c), {
        ptRequestId: id,
        source: spec.actor.source,
        actorStaffId: self,
        ...spec.actor.ownSessionsOnly(self),
        note,
      })
      c.set('auditTarget', { table: 'pt_requests', id })
      const row = await getPtRequestForAdmin(tenantId(c), id)
      return c.json({ pt_request: row ? ptRequestJson(row) : null, result })
    })
}

const surfaces: Record<Surface, Hono> = {
  admin: ptRequestsFor({
    queue: {
      // ?status=pending|scheduled|cancelled_*|attended|all (default pending), ?location_id=
      query: z.object({
        status: z
          .enum(['pending', 'scheduled', 'cancelled_before_scheduled', 'cancelled_after_scheduled', 'attended', 'all'])
          .default('pending'),
        location_id: z.string().uuid().optional(),
      }),
      filters: ({ status, location_id }) => ({
        ...(status === 'all' ? {} : { status }),
        ...(location_id ? { locationIds: [location_id] } : {}),
      }),
    },
    schedule: {
      body: z
        .object({
          instructor_id: z.string().uuid(),
          ...placeAndTime,
          // Optional: blank leaves the session Unpriced, as on an Admin's class.
          instructor_pay_sgd: z.number().min(0).nullable().optional(),
          ...forTheMember,
        })
        .refine(endsAfterStart, endsAfterStartIssue),
      staffing: b => ({ instructorId: b.instructor_id, instructorPaySgd: b.instructor_pay_sgd ?? null }),
    },
    manual: { body: adminManualSessionSchema, instructorId: b => b.instructor_id },
    seatCandidates: { query: adminSeatCandidatesQuery, instructorId: q => q.instructor_id },
    actor: {
      source: 'admin',
      // The dialog pre-selects the Bound Instructor, but an Admin may override it for
      // one session: a bound coach's illness must not block a member.
      actorIsAdmin: true,
      ownSessionsOnly: () => ({}),
    },
  }),
  instructor: ptRequestsFor({
    queue: {
      // Nothing to filter by: the pending requests this Instructor may act on, the
      // unbound ones plus those bound to them. Somebody else's bound request is not
      // work they can pick up, so it is not work they see.
      query: z.object({}),
      filters: (_q, self) => ({ status: 'pending', visibleToInstructorId: self }),
    },
    schedule: {
      body: z.object({ ...placeAndTime, ...forTheMember }).refine(endsAfterStart, endsAfterStartIssue),
      staffing: (_b, self) => ({ instructorId: self }), // forced to the acting Instructor; no pay field
    },
    // The session's instructor is always self, and a member bound to another coach is refused, not warned.
    // The body has no `instructor_pay_sgd`: an Instructor's manual session is left unpriced.
    manual: { body: instructorManualSessionSchema, instructorId: (_b, self) => self },
    // The instructor is always self, so a package bound to another coach reads as refused, not warned.
    seatCandidates: { query: instructorSeatCandidatesQuery, instructorId: (_q, self) => self },
    actor: {
      source: 'instructor',
      // Never the admin bypass: here the binding rule decides, and a request bound to
      // a different instructor is refused.
      actorIsAdmin: false,
      // A staff cancel (full refund, doesn't count to the client's cap), recorded as
      // the Instructor's, and only on a session of their own: another coach's is
      // `403 not_your_session`.
      ownSessionsOnly: self => ({ requireOwnInstructorId: self }),
    },
  }),
}

export const ptRequestRoutes = (surface: Surface): Hono => surfaces[surface]
