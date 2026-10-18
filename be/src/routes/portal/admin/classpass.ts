import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/classpass/settings'
import { tenantId } from '../../../middleware/tenant'

/**
 * The ClassPass page (#409), admins only (mounted under `requireRole('admin')`):
 * the studio's ClassPass address, its switch, Gmail's confirmation code, and
 * what has arrived at the address.
 */

const patchSchema = z.object({ enabled: z.boolean() })

function serialize(status: svc.ClassPassStatus) {
  return {
    address: status.address,
    enabled: status.enabled,
    gmail_confirmation_code: status.gmailConfirmationCode,
    gmail_confirmation_at: status.gmailConfirmationAt,
    last_received_at: status.lastReceivedAt,
    counts: status.counts,
  }
}

const app = new Hono()
  .get('/', async c => c.json(serialize(await svc.readClassPass(tenantId(c)))))
  .patch('/', zValidator('json', patchSchema), async c =>
    c.json(serialize(await svc.setClassPassEnabled(tenantId(c), c.req.valid('json').enabled))),
  )
  .post('/address/regenerate', async c => c.json(serialize(await svc.regenerateClassPassAddress(tenantId(c)))))

export default app
