import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { readMaintenance, setMaintenance, type Maintenance } from '../../services/platform/maintenance'

/**
 * Maintenance mode's switch, in the super portal. Behind `requirePlatformAdmin`
 * like the rest of the branch, and open while maintenance is on — this is how
 * it is switched off.
 */

const body = z.object({
  enabled: z.boolean(),
  message: z.string().trim().min(1).max(500).optional(),
})

function serialize(m: Maintenance) {
  return {
    enabled: m.enabled,
    message: m.message,
    updated_by: m.updatedBy,
    updated_at: m.updatedAt?.toISOString() ?? null,
  }
}

const app = new Hono()
  .get('/maintenance', async c => c.json(serialize(await readMaintenance())))
  .put('/maintenance', zValidator('json', body), async c => {
    const { enabled, message } = c.req.valid('json')
    return c.json(serialize(await setMaintenance({ enabled, message, by: c.get('platformAdminEmail') })))
  })

export default app
