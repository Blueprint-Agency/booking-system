import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/locations'
import { tenantId } from '../../../middleware/tenant'
import { countLiveUnlimitedAtLocation } from '../../../services/packages/purchase'
import { explainInvalid } from '../../explain-invalid'

const MAPS_MESSAGE = 'A Maps link must be a full link, like https://maps.app.goo.gl/…'
const createSchema = z.object({
  name: z
    .string({ message: 'A name must be text.' })
    .min(1, 'A location needs a name.')
    .max(120, 'A name can be at most 120 characters.'),
  address: z.string({ message: 'An address must be text.' }).max(500, 'An address can be at most 500 characters.').nullish(),
  gmaps_url: z
    .string({ message: MAPS_MESSAGE })
    .url(MAPS_MESSAGE)
    .max(500, 'A Maps link can be at most 500 characters.')
    .nullish(),
  phone: z.string({ message: 'A phone number must be text.' }).max(40, 'A phone number can be at most 40 characters.').nullish(),
})

const updateSchema = createSchema.partial()
const explainLocation = explainInvalid('That location is not valid.')

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  include_archived: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
})

function serialize(row: svc.LocationRow) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    gmaps_url: row.gmapsUrl,
    phone: row.phone,
    archived_at: row.archivedAt,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const includeArchived = q.include_archived === 'true' || q.include_archived === '1'
    const rows = await svc.listLocations(tenantId(c), { includeArchived })
    return c.json({ locations: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getLocation(tenantId(c), id)
    return c.json(serialize(row))
  })
  .post('/', zValidator('json', createSchema, explainLocation), async c => {
    const body = c.req.valid('json')
    const row = await svc.createLocation(tenantId(c), {
      name: body.name,
      address: body.address ?? null,
      gmapsUrl: body.gmaps_url ?? null,
      phone: body.phone ?? null,
    })
    c.set('auditTarget' as any, { table: 'locations', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema, explainLocation), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updateLocation(tenantId(c), id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.address !== undefined ? { address: body.address ?? null } : {}),
      ...(body.gmaps_url !== undefined ? { gmapsUrl: body.gmaps_url ?? null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone ?? null } : {}),
    })
    c.set('auditTarget' as any, { table: 'locations', id })
    return c.json(serialize(row))
  })
  .get('/:id/live-unlimited-count', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json({ count: await countLiveUnlimitedAtLocation(tenantId(c), id, new Date()) })
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveLocation(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'locations', id })
    return c.json(serialize(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveLocation(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'locations', id })
    return c.json(serialize(row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteLocation(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'locations', id })
    return c.body(null, 204)
  })

export default app
