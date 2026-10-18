import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/classpass/settings'
import * as locationSvc from '../../../services/classpass/locations'
import * as reviewSvc from '../../../services/classpass/review'
import { tenantId } from '../../../middleware/tenant'

/**
 * The ClassPass page (#409), admins only (mounted under `requireRole('admin')`):
 * the studio's ClassPass address, its switch, Gmail's confirmation code, and
 * what has arrived at the address.
 */

const patchSchema = z.object({ enabled: z.boolean() })

const idParam = z.object({ id: z.string().uuid() })
const mappingSchema = z.object({
  location_name: z.string().trim().min(1).max(200),
  location_id: z.string().uuid(),
})
const mappingPatchSchema = mappingSchema.partial()
const bookSchema = z.object({ class_id: z.string().uuid() })
const locationSchema = z.object({ location_id: z.string().uuid() })

function serializeReviewItem(item: reviewSvc.ClassPassReviewItem) {
  return {
    id: item.id,
    received_at: item.receivedAt,
    subject: item.subject,
    outcome: item.outcome,
    reason: item.reason,
    reservation_id: item.reservationId,
    class_name: item.className,
    location_name: item.locationName,
    starts_at: item.startsAt,
    member_name: item.memberName,
    member_email: item.memberEmail,
    text: item.text,
    html: item.html,
    booking_id: item.bookingId,
    resolved_at: item.resolvedAt,
    resolved_by_staff_id: item.resolvedByStaffId,
  }
}

function serializeMapping(row: locationSvc.ClassPassLocationMapping) {
  return {
    id: row.id,
    location_name: row.locationName,
    location_id: row.locationId,
    location: { name: row.location.name, archived_at: row.location.archivedAt },
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function serialize(status: svc.ClassPassStatus) {
  return {
    address: status.address,
    enabled: status.enabled,
    gmail_confirmation_code: status.gmailConfirmationCode,
    gmail_confirmation_at: status.gmailConfirmationAt,
    last_received_at: status.lastReceivedAt,
    counts: status.counts,
    overbooked: status.overbooked.map(o => ({
      booking_id: o.bookingId,
      class_id: o.classId,
      class_name: o.className,
      starts_at: o.startsAt,
      client_name: o.clientName,
    })),
  }
}

const app = new Hono()
  .get('/', async c => c.json(serialize(await svc.readClassPass(tenantId(c)))))
  .patch('/', zValidator('json', patchSchema), async c =>
    c.json(serialize(await svc.setClassPassEnabled(tenantId(c), c.req.valid('json').enabled))),
  )
  .post('/address/regenerate', async c => c.json(serialize(await svc.regenerateClassPassAddress(tenantId(c)))))
  // ClassPass location mappings (#410): ClassPass's name for a location -> one of the studio's Locations.
  .get('/locations', async c =>
    c.json({ mappings: (await locationSvc.listClassPassLocationMappings(tenantId(c))).map(serializeMapping) }),
  )
  .post('/locations', zValidator('json', mappingSchema), async c => {
    const body = c.req.valid('json')
    const row = await locationSvc.addClassPassLocationMapping(tenantId(c), {
      locationName: body.location_name,
      locationId: body.location_id,
    })
    c.set('auditTarget' as any, { table: 'classpass_location_mappings', id: row.id })
    return c.json(serializeMapping(row), 201)
  })
  .patch('/locations/:id', zValidator('param', idParam), zValidator('json', mappingPatchSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await locationSvc.changeClassPassLocationMapping(tenantId(c), id, {
      locationName: body.location_name,
      locationId: body.location_id,
    })
    c.set('auditTarget' as any, { table: 'classpass_location_mappings', id })
    return c.json(serializeMapping(row))
  })
  .delete('/locations/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await locationSvc.removeClassPassLocationMapping(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'classpass_location_mappings', id })
    return c.body(null, 204)
  })
  // ClassPass review (#413): the booking emails the importer could not place, and closing each one.
  .get('/review', async c => c.json({ items: (await reviewSvc.listClassPassReview(tenantId(c))).map(serializeReviewItem) }))
  .post('/review/:id/book', zValidator('param', idParam), zValidator('json', bookSchema), async c => {
    const { id } = c.req.valid('param')
    const item = await reviewSvc.bookClassPassReviewItem(tenantId(c), id, c.req.valid('json').class_id, c.get('staffUserId'))
    c.set('auditTarget' as any, { table: 'classpass_inbound_emails', id })
    return c.json(serializeReviewItem(item))
  })
  .post('/review/:id/dismiss', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const item = await reviewSvc.dismissClassPassReviewItem(tenantId(c), id, c.get('staffUserId'))
    c.set('auditTarget' as any, { table: 'classpass_inbound_emails', id })
    return c.json(serializeReviewItem(item))
  })
  .post('/review/:id/location', zValidator('param', idParam), zValidator('json', locationSchema), async c => {
    const { id } = c.req.valid('param')
    const result = await reviewSvc.mapClassPassReviewLocation(tenantId(c), id, c.req.valid('json').location_id, c.get('staffUserId'))
    c.set('auditTarget' as any, { table: 'classpass_location_mappings', id: result.mapping.id })
    return c.json({ mapping: serializeMapping(result.mapping), items: result.items.map(serializeReviewItem) })
  })

export default app
