import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../../middleware/tenant'
import { listStudioEmails, setEmailSwitch } from '../../../services/notifications/switch-state'

/**
 * The studio's emails and their switches (be-portal.md § emails.ts): every
 * email it sends, to members and to staff, each on or off for the whole
 * studio. A locked one is listed, and refused a change.
 */
const slugParam = z.object({ slug: z.string().min(1).max(64) })
const patchBody = z.object({ enabled: z.boolean({ message: 'Say whether the email is on or off.' }) })

const app = new Hono()
  .get('/', async c => c.json(await listStudioEmails(tenantId(c))))
  .patch('/:slug', zValidator('param', slugParam), zValidator('json', patchBody), async c =>
    c.json(await setEmailSwitch(tenantId(c), c.req.valid('param').slug, c.req.valid('json').enabled, c.get('staffUserId'))),
  )

export default app
