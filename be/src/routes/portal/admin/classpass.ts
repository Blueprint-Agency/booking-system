import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/classpass/settings'
import * as locationSvc from '../../../services/classpass/locations'
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

export default app
