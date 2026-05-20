import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/rooms'

const createSchema = z.object({
  location_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  capacity: z.number().int().min(1),
})
const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  capacity: z.number().int().min(1).optional(),
})
const idParam = z.object({ id: z.string().uuid() })
const listQuery = z.object({
  location_id: z.string().uuid().optional(),
  include_archived: z.string().optional(),
})

function serialize(row: svc.RoomRow) {
  return {
    id: row.id,
    location_id: row.locationId,
    name: row.name,
    capacity: row.capacity,
    archived_at: row.archivedAt,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const includeArchived = q.include_archived === 'true' || q.include_archived === '1'
    const rows = await svc.listRooms({ locationId: q.location_id, includeArchived })
    return c.json({ rooms: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getRoom(id)
    return c.json(serialize(row))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.createRoom(body)
    c.set('auditTarget' as any, { table: 'rooms', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updateRoom(id, body)
    c.set('auditTarget' as any, { table: 'rooms', id })
    return c.json(serialize(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveRoom(id)
    c.set('auditTarget' as any, { table: 'rooms', id })
    return c.json(serialize(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveRoom(id)
    c.set('auditTarget' as any, { table: 'rooms', id })
    return c.json(serialize(row))
  })

export default app
