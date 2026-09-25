import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { join, leave } from '../../services/waitlist/entries'
import { listForClient } from '../../services/waitlist/line'
import { tenantId } from '../../middleware/tenant'
import { now } from '../../lib/clock'

/** A member's class waitlists (spec-waitlist.md §4, §6, §9; be-client.md). */
const app = new Hono()
  .get('/', async c => {
    const rows = await listForClient(tenantId(c), c.get('clientId'))
    return c.json({
      entries: rows.map(r => ({
        id: r.id,
        class_id: r.classId,
        name: r.className,
        instructor: r.instructorName,
        location: r.locationName,
        starts_at: r.startsAt.toISOString(),
        ends_at: r.endsAt.toISOString(),
        joined_at: r.joinedAt.toISOString(),
        position: r.position,
      })),
    })
  })
  .post('/classes/:classId', zValidator('param', z.object({ classId: z.string().uuid() })), async c => {
    const { classId } = c.req.valid('param')
    const res = await join(tenantId(c), c.get('clientId'), classId, now())
    return c.json({ entry_id: res.entryId, position: res.position }, 201)
  })
  .delete('/:entryId', zValidator('param', z.object({ entryId: z.string().uuid() })), async c => {
    const { entryId } = c.req.valid('param')
    await leave(tenantId(c), c.get('clientId'), entryId, now())
    return c.body(null, 204)
  })

export default app
