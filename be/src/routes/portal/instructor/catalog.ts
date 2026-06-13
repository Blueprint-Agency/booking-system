import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as classTypesSvc from '../../../services/catalog/class-types'
import * as roomsSvc from '../../../services/catalog/rooms'

/**
 * Read-only catalog for the instructor scheduling forms. Mirrors the admin
 * catalog reads but lives under /portal/instructor/* so the instructor surface
 * never has to call an admin endpoint. Archived rows are excluded.
 */

const roomsQuery = z.object({ location_id: z.string().uuid().optional() })

const app = new Hono()
  .get('/class-types', async c => {
    const rows = await classTypesSvc.listClassTypes({ includeArchived: false })
    return c.json({
      class_types: rows.map(r => ({ id: r.id, name: r.name, difficulty: r.difficulty })),
    })
  })
  .get('/rooms', zValidator('query', roomsQuery), async c => {
    const q = c.req.valid('query')
    const rows = await roomsSvc.listRooms({ locationId: q.location_id, includeArchived: false })
    return c.json({
      rooms: rows.map(r => ({
        id: r.id,
        location_id: r.locationId,
        name: r.name,
        capacity: r.capacity,
      })),
    })
  })

export default app
