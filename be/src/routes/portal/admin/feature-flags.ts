import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/feature-flags'
import { tenantId } from '../../../middleware/tenant'

/**
 * The studio's own switchboard (be-portal.md §feature-flags.ts). A flag is one
 * studio's switch — the key is unique per Tenant — so switching it here never
 * reaches another studio. The cache is process-local; a multi-instance deploy
 * needs a pub/sub nudge, which is deferred.
 */

const keyParam = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) })
const patchSchema = z.object({ enabled: z.boolean() })

function serialize(row: svc.FeatureFlagRow) {
  return { key: row.key, enabled: row.enabled, updated_at: row.updatedAt }
}

const app = new Hono()
  .get('/', async c => c.json({ feature_flags: (await svc.listFlags(tenantId(c))).map(serialize) }))
  .patch('/:key', zValidator('param', keyParam), zValidator('json', patchSchema), async c => {
    const { key } = c.req.valid('param')
    const row = await svc.setFlag(tenantId(c), key, c.req.valid('json').enabled, c.get('staffUserId'))
    return c.json(serialize(row))
  })

export default app
