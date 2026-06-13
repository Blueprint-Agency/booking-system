import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  getInstructor,
  updateInstructor,
  type InstructorView,
} from '../../../services/catalog/instructors'

/**
 * Instructor profile — the caller's own row only (id is taken from the auth
 * context, never the body). View identity + edit bio/phone. Photo upload needs
 * R2 (deferred project-wide) — photo_r2_key is read-only here for now.
 */

const patchSchema = z.object({
  bio: z.string().max(2000).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
})

function serialize(v: InstructorView, role: string, email: string) {
  return {
    id: v.id,
    name: v.name,
    email,
    role,
    status: v.status,
    bio: v.bio,
    phone: v.phone,
    photo_r2_key: v.photoR2Key,
  }
}

const app = new Hono()
  .get('/', async c => {
    const self = c.get('staffUserId')
    const row = c.get('staffRow')
    const view = await getInstructor(self)
    return c.json(serialize(view, row.role, row.email))
  })
  .patch('/', zValidator('json', patchSchema), async c => {
    const self = c.get('staffUserId')
    const row = c.get('staffRow')
    const body = c.req.valid('json')
    const view = await updateInstructor(self, {
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
    })
    c.set('auditTarget' as any, { table: 'instructors', id: self })
    return c.json(serialize(view, row.role, row.email))
  })

export default app
