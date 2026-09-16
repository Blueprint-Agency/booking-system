import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/instructors'
import { tenantId } from '../../../middleware/tenant'

const statusEnum = z.enum(['pending', 'active', 'archived'])

const listQuery = z.object({ status: statusEnum.optional() })
const idParam = z.object({ id: z.string().uuid() })

const createSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120),
  bio: z.string().max(4000).nullish(),
  phone: z.string().max(40).nullish(),
  photo_r2_key: z.string().max(500).nullish(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  bio: z.string().max(4000).nullish().optional(),
  phone: z.string().max(40).nullish().optional(),
  photo_r2_key: z.string().max(500).nullish().optional(),
})

function serialize(v: svc.InstructorView) {
  return {
    id: v.id,
    email: v.email,
    name: v.name,
    status: v.status,
    archived_at: v.archivedAt,
    invited_at: v.invitedAt,
    accepted_at: v.acceptedAt,
    bio: v.bio,
    phone: v.phone,
    photo_r2_key: v.photoR2Key,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listInstructors(tenantId(c), { status: q.status })
    return c.json({ instructors: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(serialize(await svc.getInstructor(tenantId(c), id)))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const view = await svc.createInstructor(tenantId(c), {
      email: body.email,
      name: body.name,
      bio: body.bio ?? null,
      phone: body.phone ?? null,
      photoR2Key: body.photo_r2_key ?? null,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id: view.id })
    return c.json(serialize(view), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const view = await svc.updateInstructor(tenantId(c), id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.bio !== undefined ? { bio: body.bio ?? null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone ?? null } : {}),
      ...(body.photo_r2_key !== undefined ? { photoR2Key: body.photo_r2_key ?? null } : {}),
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serialize(view))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const view = await svc.archiveInstructor(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serialize(view))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const view = await svc.unarchiveInstructor(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serialize(view))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteInstructor(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.body(null, 204)
  })

export default app
