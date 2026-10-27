import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  getInstructor,
  updateInstructor,
  type InstructorView,
} from '../../../services/catalog/instructors'
import { tenantId } from '../../../middleware/tenant'
import { publicObjectUrl } from '../../../lib/r2'

/**
 * Instructor profile — the caller's own row only (id is taken from the auth
 * context, never the body). View identity + edit bio/phone. The picture is set
 * through `/portal/profile/photo`, the route every staff member shares.
 */

const patchSchema = z.object({
  bio: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
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
    photo_url: publicObjectUrl(v.photoR2Key),
  }
}

const app = new Hono()
  .get('/', async c => {
    const self = c.get('staffUserId')
    const row = c.get('staffRow')
    const view = await getInstructor(tenantId(c), self)
    return c.json(serialize(view, row.role, row.email))
  })
  .patch('/', zValidator('json', patchSchema), async c => {
    const self = c.get('staffUserId')
    const row = c.get('staffRow')
    const body = c.req.valid('json')
    const view = await updateInstructor(tenantId(c), self, {
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
    })
    c.set('auditTarget' as any, { table: 'instructors', id: self })
    return c.json(serialize(view, row.role, row.email))
  })

export default app
