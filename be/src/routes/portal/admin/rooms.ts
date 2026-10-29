import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/rooms'
import { tenantId } from '../../../middleware/tenant'
import { explainInvalid } from '../../explain-invalid'

const nameField = z
  .string({ message: 'A name must be text.' })
  .min(1, 'A room needs a name.')
  .max(120, 'A name can be at most 120 characters.')
const CAPACITY_MESSAGE = 'A capacity is a whole number of at least 1.'
const capacityField = z.number({ message: CAPACITY_MESSAGE }).int(CAPACITY_MESSAGE).min(1, CAPACITY_MESSAGE)

const createSchema = z.object({
  location_id: z.string({ message: 'Choose a location.' }).uuid('Choose a location.'),
  name: nameField,
  capacity: capacityField,
})
const updateSchema = z.object({
  name: nameField.optional(),
  capacity: capacityField.optional(),
})
const explainRoom = explainInvalid('That room is not valid.')
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
    const rows = await svc.listRooms(tenantId(c), { locationId: q.location_id, includeArchived })
    return c.json({ rooms: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getRoom(tenantId(c), id)
    return c.json(serialize(row))
  })
  .post('/', zValidator('json', createSchema, explainRoom), async c => {
    const body = c.req.valid('json')
    const row = await svc.createRoom(tenantId(c), body)
    c.set('auditTarget', { table: 'rooms', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema, explainRoom), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updateRoom(tenantId(c), id, body)
    c.set('auditTarget', { table: 'rooms', id })
    return c.json(serialize(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveRoom(tenantId(c), id)
    c.set('auditTarget', { table: 'rooms', id })
    return c.json(serialize(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveRoom(tenantId(c), id)
    c.set('auditTarget', { table: 'rooms', id })
    return c.json(serialize(row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteRoom(tenantId(c), id)
    c.set('auditTarget', { table: 'rooms', id })
    return c.body(null, 204)
  })

export default app
