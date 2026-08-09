import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/corporate/sessions'

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  location_id: z.string().uuid().optional(),
})

const createSchema = z.object({
  corporate_package_id: z.string().uuid(),
  client_name: z.string().min(1).max(160),
  main_instructor_id: z.string().uuid(),
  supporting_instructor_ids: z.array(z.string().uuid()).default([]),
  location_id: z.string().uuid(),
  room_id: z.string().uuid(),
  starts_at: isoDate,
  ends_at: isoDate,
})

const updateSchema = createSchema.partial()

function serialize(r: svc.CorporateSessionRow) {
  return {
    id: r.id,
    corporate_package_id: r.corporatePackageId,
    client_name: r.clientName,
    main_instructor_id: r.mainInstructorId,
    location_id: r.locationId,
    location_text: r.locationText,
    room_id: r.roomId,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    lifecycle: r.lifecycle,
    cancelled_at: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    cancelled_by_staff_id: r.cancelledByStaffId,
    created_at: r.createdAt.toISOString(),
    created_by_staff_id: r.createdByStaffId,
  }
}

function serializeHydrated(r: svc.CorporateSessionHydrated) {
  return {
    ...serialize(r),
    supporting_instructor_ids: r.supportingInstructorIds,
  }
}

function statusFor(error: svc.CorporateSessionError): 400 | 404 | 409 | 422 {
  switch (error) {
    case 'package_archived':
      return 422
    case 'package_not_found':
      return 404
    case 'bad_time_range':
    case 'location_required':
      return 400
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listCorporateSessions({
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      locationId: q.location_id,
    })
    return c.json({ corporate_sessions: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getCorporateSession(id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({ corporate_session: serializeHydrated(row) })
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId') as string

    const startsAt = new Date(body.starts_at)
    const endsAt = new Date(body.ends_at)

    const result = await svc.createCorporateSession({
      corporatePackageId: body.corporate_package_id,
      clientName: body.client_name,
      mainInstructorId: body.main_instructor_id,
      supportingInstructorIds: body.supporting_instructor_ids,
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt,
      endsAt,
      createdByStaffId: actor,
    })

    if (!result.ok) {
      return c.json({ error: result.error }, statusFor(result.error))
    }
    c.set('auditTarget' as any, { table: 'corporate_sessions', id: result.session.id })
    return c.json({ corporate_session: serialize(result.session) }, 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')

    const patch: svc.RescheduleCorporateSessionPatch = {}
    if (body.corporate_package_id !== undefined) patch.corporatePackageId = body.corporate_package_id
    if (body.client_name !== undefined) patch.clientName = body.client_name
    if (body.main_instructor_id !== undefined) patch.mainInstructorId = body.main_instructor_id
    if (body.supporting_instructor_ids !== undefined) {
      patch.supportingInstructorIds = body.supporting_instructor_ids
    }
    if (body.location_id !== undefined) patch.locationId = body.location_id
    if (body.room_id !== undefined) patch.roomId = body.room_id
    if (body.starts_at !== undefined) patch.startsAt = new Date(body.starts_at)
    if (body.ends_at !== undefined) patch.endsAt = new Date(body.ends_at)

    const result = await svc.rescheduleCorporateSession(id, patch)
    if (!result.ok) {
      if (result.error === 'not_found') return c.json({ error: 'not_found' }, 404)
      return c.json({ error: result.error }, statusFor(result.error))
    }
    c.set('auditTarget' as any, { table: 'corporate_sessions', id })
    return c.json({ corporate_session: serialize(result.session) })
  })
  .post('/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId') as string
    const row = await svc.cancelCorporateSession(id, actor)
    if (!row) return c.json({ error: 'not_found_or_already_cancelled' }, 404)
    c.set('auditTarget' as any, { table: 'corporate_sessions', id })
    return c.json({ corporate_session: serialize(row) })
  })

export default app
