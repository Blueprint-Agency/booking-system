import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/corporate/requests'

// Corporate request triage for staff. Mirrors the PT request flow: no approve/
// decline — admin negotiates over WhatsApp, then schedules (the implicit
// approval) or cancels. See docs/md/be-portal.md §Corporate.

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  status: z.enum(['pending', 'scheduled', 'cancelled', 'attended', 'all']).default('pending'),
})

const scheduleSchema = z
  .object({
    main_instructor_id: z.string().uuid(),
    supporting_instructor_ids: z.array(z.string().uuid()).default([]),
    // Either a studio location (location_id, optional room_id) OR a free-text
    // off-site venue (location_text). Room is optional.
    location_id: z.string().uuid().optional(),
    location_text: z.string().trim().min(1).max(300).optional(),
    room_id: z.string().uuid().optional(),
    starts_at: isoDate,
    ends_at: isoDate,
  })
  .refine(v => Boolean(v.location_id) || Boolean(v.location_text), {
    message: 'either location_id or location_text is required',
    path: ['location_id'],
  })
  .refine(v => !v.room_id || Boolean(v.location_id), {
    message: 'room_id requires a studio location_id',
    path: ['room_id'],
  })

function serialize(r: svc.HydratedCorporateRequest) {
  return {
    id: r.id,
    status: r.status,
    preferred_location: r.preferredLocation,
    message: r.message,
    created_at: r.createdAt.toISOString(),
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    client: r.client,
    package: r.package,
    session: r.session
      ? {
          id: r.session.id,
          starts_at: r.session.startsAt.toISOString(),
          ends_at: r.session.endsAt.toISOString(),
          location_name: r.session.locationName,
          instructor_name: r.session.instructorName,
        }
      : null,
  }
}

function statusForScheduleError(error: svc.ScheduleCorporateRequestError): 400 | 404 | 409 | 422 {
  switch (error) {
    case 'request_not_found':
    case 'package_not_found':
      return 404
    case 'not_pending':
    case 'room_conflict':
    case 'instructor_conflict':
      return 409
    case 'package_archived':
      return 422
    case 'main_in_supporting':
    case 'bad_time_range':
    case 'location_required':
      return 400
  }
}

const app = new Hono()
  // ?status=pending|scheduled|cancelled|attended|all — defaults to pending.
  .get('/', zValidator('query', listQuery), async c => {
    const { status } = c.req.valid('query')
    const rows = await svc.listCorporateRequests(status === 'all' ? {} : { status })
    return c.json({ corporate_requests: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getCorporateRequest(id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({ corporate_request: serialize(row) })
  })
  // Schedule a pending request → creates the corporate_session, flips to scheduled.
  .post('/:id/schedule', zValidator('param', idParam), zValidator('json', scheduleSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId') as string

    const result = await svc.scheduleCorporateRequest({
      corporateRequestId: id,
      mainInstructorId: body.main_instructor_id,
      supportingInstructorIds: body.supporting_instructor_ids,
      locationId: body.location_id,
      locationText: body.location_text,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      actorStaffId: actor,
    })
    if (!result.ok) {
      return c.json({ error: result.error }, statusForScheduleError(result.error))
    }
    c.set('auditTarget' as any, { table: 'corporate_requests', id })
    const row = await svc.getCorporateRequest(id)
    return c.json({ corporate_request: row ? serialize(row) : null }, 201)
  })
  .post('/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId') as string
    const row = await svc.cancelCorporateRequest(id, actor)
    if (!row) return c.json({ error: 'not_found' }, 404)
    c.set('auditTarget' as any, { table: 'corporate_requests', id })
    const hydrated = await svc.getCorporateRequest(id)
    return c.json({ corporate_request: hydrated ? serialize(hydrated) : null })
  })
  .post('/:id/attended', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId') as string
    const row = await svc.markCorporateRequestAttended(id, actor)
    if (!row) return c.json({ error: 'not_found' }, 404)
    c.set('auditTarget' as any, { table: 'corporate_requests', id })
    const hydrated = await svc.getCorporateRequest(id)
    return c.json({ corporate_request: hydrated ? serialize(hydrated) : null })
  })

export default app
