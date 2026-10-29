import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getPtRequestForAdmin } from '../../../services/pt-sessions/list'
import { linkPtRequestPartner } from '../../../services/pt-sessions/request'
import { tenantId } from '../../../middleware/tenant'
import { explainInvalid } from '../../explain-invalid'
import { ERROR_CODES } from '../../../shared/error-codes'
import { updatePtSession } from '../../../services/pt-sessions/schedule'
import { getPtSessionDetail, type PtSessionDetail } from '../../../services/schedule/detail'
import { dateTime } from '../../../shared/date-time'
import { idParam, supportingInstructorSchema, toAssignments } from '../parse'
import { ptRequestJson, ptRequestRoutes } from '../pt-request-routes'

// PT request triage for admins. No "approve"/"decline" in the simplified flow —
// admin negotiates over WhatsApp, then either schedules (the implicit approval)
// or cancels. See docs/md/be-portal.md §3c.
//
// The queue, schedule, cancel, Manual session, seat candidates and the add and
// remove of a member are written once for both portals (`../pt-request-routes.ts`;
// the Instructor's mount is `../instructor/pt-requests.ts`). What stays here only
// an Admin may do: reading one request, editing a scheduled session, and linking
// a partner.

// PATCH /sessions/:id targets a SCHEDULED pt_sessions row (distinct from the pt_requests
// id used by the routes above) — the only id space with starts_at/room/etc.
const updateSessionSchema = z.object({
  starts_at: dateTime('A start time').optional(),
  ends_at: dateTime('An end time').optional(),
  room_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  session_type: z.enum(['1on1', '2on1']).optional(),
  // Partner for a 1on1 → 2on1 upgrade. Only needed when the request doesn't
  // already carry a co-client. See services/pt-sessions/schedule.ts.
  co_client_id: z.string().uuid().optional(),
  // A manual session's upgrade only: the partner pays their own seat,
  // from this package or else the Default payer, and `override` is "Add anyway".
  co_client_package_id: z.string().uuid().optional(),
  override: z.boolean().optional(),
  // "Save anyway" after `time_clash`: moved, or joined by the partner, the
  // session overlaps a booking someone on it already holds.
  allow_clash: z.boolean().optional(),
  instructor_id: z.string().uuid().optional(),
  instructor_pay_sgd: z.number().min(0).nullable().optional(),
  supporting_instructors: z.array(supportingInstructorSchema).optional(),
})

const PARTNER_EMAIL_MESSAGE = 'Enter the partner’s full email address, like name@example.com.'
const linkPartnerSchema = z
  .object({
    client_id: z.string().uuid('That partner is not one of the studio’s members.').optional(),
    email: z.string({ message: PARTNER_EMAIL_MESSAGE }).email(PARTNER_EMAIL_MESSAGE).optional(),
  })
  .refine(v => Boolean(v.client_id || v.email), {
    message: 'Name the partner by a member or an email address.',
  })
const explainLinkPartner = explainInvalid('That partner is not valid.')

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
  // The shared routes come first: their static paths (`/seat-candidates`) must be
  // registered before `/:id` below, which would otherwise take the path for an id.
  .route('/', ptRequestRoutes('admin'))
  .get('/:id', zValidator('param', idParam), async c => {
    const row = await getPtRequestForAdmin(tenantId(c), c.req.valid('param').id)
    if (!row) return c.json({ error: ERROR_CODES.not_found }, 404)
    return c.json({ pt_request: ptRequestJson(row) })
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
      actorStaffId: c.get('staffUserId'),
      ...(body.instructor_pay_sgd !== undefined ? { instructorPaySgd: body.instructor_pay_sgd } : {}),
      ...(body.supporting_instructors !== undefined
        ? { supportingInstructors: toAssignments(body.supporting_instructors) }
        : {}),
    })
    c.set('auditTarget', { table: 'pt_sessions', id })
    if (body.allow_clash) c.set('auditDetail', { allow_clash: true })
    const detail = await getPtSessionDetail(tenantId(c), id)
    return c.json(serializeSession(detail))
  })
  .post('/:id/link-partner', zValidator('param', idParam), zValidator('json', linkPartnerSchema, explainLinkPartner), async c => {
    const { id } = c.req.valid('param')
    const { client_id, email } = c.req.valid('json')
    await linkPtRequestPartner({
      tenantId: tenantId(c),
      ptRequestId: id,
      coClientId: client_id,
      email,
    })
    c.set('auditTarget', { table: 'pt_requests', id })
    const row = await getPtRequestForAdmin(tenantId(c), id)
    return c.json({ pt_request: row ? ptRequestJson(row) : null })
  })

export default app
