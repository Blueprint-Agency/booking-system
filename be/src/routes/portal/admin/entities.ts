import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/entities'
import { tenantId } from '../../../middleware/tenant'
import { explainInvalid } from '../../explain-invalid'

const nameField = z
  .string({ message: 'A name must be text.' })
  .trim()
  .min(1, 'An entity needs a name.')
  .max(80, 'A name can be at most 80 characters.')
// Shape is judged by the service (`entity_slug_invalid`), which says why; here it only has to be text.
const slugField = z.string({ message: 'A slug must be text.' })

const createSchema = z.object({
  name: nameField,
  slug: slugField.optional(),
})
const updateSchema = z
  .object({
    name: nameField.optional(),
    slug: slugField.optional(),
  })
  .refine(body => body.name !== undefined || body.slug !== undefined, 'Change the name or the slug.')
// Every live Entity once, in the order wanted; whether that is so is the service's call.
const orderSchema = z.object({ ids: z.array(z.string().uuid('Send Entity ids.')) })
const explainEntity = explainInvalid('That entity is not valid.')
const idParam = z.object({ id: z.string().uuid() })
const listQuery = z.object({
  include_archived: z.string().optional(),
})

function serialize(row: svc.EntityWithUsage) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    archived_at: row.archivedAt,
    in_use: row.inUse,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const includeArchived = q.include_archived === 'true' || q.include_archived === '1'
    const rows = await svc.listEntities(tenantId(c), { includeArchived })
    return c.json({ entities: rows.map(serialize) })
  })
  .post('/', zValidator('json', createSchema, explainEntity), async c => {
    const body = c.req.valid('json')
    const row = await svc.createEntity(tenantId(c), body)
    c.set('auditTarget', { table: 'entities', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema, explainEntity), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.updateEntity(tenantId(c), id, c.req.valid('json'))
    c.set('auditTarget', { table: 'entities', id })
    return c.json(serialize(row))
  })
  // Registered before `/:id/…` so "order" is never read as an id.
  .put('/order', zValidator('json', orderSchema, explainEntity), async c => {
    const rows = await svc.reorderEntities(tenantId(c), c.req.valid('json').ids)
    return c.json({ entities: rows.map(serialize) })
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveEntity(tenantId(c), id)
    c.set('auditTarget', { table: 'entities', id })
    return c.json(serialize(row))
  })

export default app
