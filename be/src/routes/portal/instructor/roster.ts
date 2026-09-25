import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getOwnClassDetail } from '../../../services/schedule/detail'
import { searchClients } from '../../../services/clients/manage'
import { tenantId } from '../../../middleware/tenant'
import { classSeatsJson } from '../class-seats'

/**
 * The instructor's session page (spec-waitlist.md §10):
 *
 *   GET /sessions/class/:id/roster — a class the caller teaches: its seats and
 *                                    its roster, each row tagged with its seat.
 *                                    No pay figures. 403 `not_your_session` for
 *                                    anyone else's class.
 *   GET /clients?q=               — find a member to add to the roster.
 */

const searchQuery = z.object({ q: z.string().trim().min(1).max(100) })

const app = new Hono()
  .get(
    '/sessions/class/:id/roster',
    zValidator('param', z.object({ id: z.string().uuid() })),
    async c => {
      const { id } = c.req.valid('param')
      const d = await getOwnClassDetail(tenantId(c), id, c.get('staffUserId'))
      return c.json({
        id: d.id,
        lifecycle: d.lifecycle,
        starts_at: d.startsAt.toISOString(),
        ends_at: d.endsAt.toISOString(),
        class_type: d.classType,
        difficulty: d.difficulty,
        instructor: d.instructor,
        location: d.location,
        room: d.room,
        capacity_online: d.capacityOnline,
        capacity_waitlist: d.capacityWaitlist,
        capacity_buffer: d.capacityBuffer,
        credit_cost: d.creditCost,
        ...classSeatsJson(d),
        check_in_state: d.checkInState,
      })
    },
  )
  .get('/clients', zValidator('query', searchQuery), async c => {
    const rows = await searchClients(tenantId(c), c.req.valid('query').q)
    return c.json({ clients: rows.map(r => ({ id: r.id, name: r.name, email: r.email })) })
  })

export default app
