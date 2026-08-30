import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/class-types'
import { tenantId } from '../../../middleware/tenant'

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  difficulty: z.enum(['general', 'beginner', 'intermediate', 'advanced']).optional(),
  parent_id: z.string().uuid().nullable().optional(),
})
const updateSchema = createSchema.partial()
const idParam = z.object({ id: z.string().uuid() })
const listQuery = z.object({ include_archived: z.string().optional() })

function serialize(row: svc.ClassTypeRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    difficulty: row.difficulty,
    parent_id: row.parentId,
    archived_at: row.archivedAt,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const includeArchived = q.include_archived === 'true' || q.include_archived === '1'
    const rows = await svc.listClassTypes(tenantId(c), { includeArchived })
    return c.json({ class_types: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getClassType(tenantId(c), id)
    return c.json(serialize(row))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.createClassType(tenantId(c), body)
    c.set('auditTarget' as any, { table: 'class_types', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updateClassType(tenantId(c), id, body)
    c.set('auditTarget' as any, { table: 'class_types', id })
    return c.json(serialize(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveClassType(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'class_types', id })
    return c.json(serialize(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveClassType(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'class_types', id })
    return c.json(serialize(row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteClassType(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'class_types', id })
    return c.body(null, 204)
  })

export default app
