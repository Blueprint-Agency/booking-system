import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/locations'
import { countLiveUnlimitedAtLocation } from '../../../services/packages/purchase'

const createSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(500).nullish(),
  gmaps_url: z.string().url().max(500).nullish(),
  phone: z.string().max(40).nullish(),
})

const updateSchema = createSchema.partial()

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
    const rows = await svc.listLocations({ includeArchived })
    return c.json({ locations: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getLocation(id)
    return c.json(serialize(row))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.createLocation({
      name: body.name,
      address: body.address ?? null,
      gmapsUrl: body.gmaps_url ?? null,
      phone: body.phone ?? null,
    })
    c.set('auditTarget' as any, { table: 'locations', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updateLocation(id, {
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
    return c.json({ count: await countLiveUnlimitedAtLocation(id, new Date()) })
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveLocation(id)
    c.set('auditTarget' as any, { table: 'locations', id })
    return c.json(serialize(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveLocation(id)
    c.set('auditTarget' as any, { table: 'locations', id })
    return c.json(serialize(row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteLocation(id)
    c.set('auditTarget' as any, { table: 'locations', id })
    return c.body(null, 204)
  })

export default app
