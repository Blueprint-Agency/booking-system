import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/instructors'
import { tenantId } from '../../../middleware/tenant'

const statusEnum = z.enum(['pending', 'active', 'archived'])

const listQuery = z.object({ status: statusEnum.optional() })

const createSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120),
  bio: z.string().max(4000).nullish(),
  phone: z.string().max(40).nullish(),
  photo_r2_key: z.string().max(500).nullish(),
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
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const view = await svc.createInstructor(tenantId(c), {
      email: body.email,
      name: body.name,
      bio: body.bio ?? null,
      phone: body.phone ?? null,
      photoR2Key: body.photo_r2_key ?? null,
      invitedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'staff_users', id: view.id })
    return c.json(serialize(view), 201)
  })

export default app
