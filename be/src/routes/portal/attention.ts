import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { attentionPanel, attentionSummary, type AttentionCaller } from '../../services/attention'
import { explainInvalid } from '../explain-invalid'

/**
 * /api/v1/portal/attention: what is waiting on the signed-in staff member, the
 * numbers behind the portal's bell and the list behind its panel.
 *
 * Mounted at the portal ROOT beside /leave, not in either role's subtree: both
 * roles read it, and what each is owed is decided per kind in the service from
 * the caller's role and Instructor Permissions, both re-resolved by `staffAuth`
 * on every request. The parent's staffAuth + requireActiveStaff is the access
 * control (routes/portal/index.ts). Read-only, so it needs no audit row.
 */
const summaryQuery = z.object({ location_id: z.string().uuid().optional() })
const listQuery = z.object({
  limit_per_group: z.coerce.number().int().min(1).max(50).optional(),
  // The Updates tab pages by this (#490); no Updates exist yet, so it is read and unused.
  updates_before: z.string().max(100).optional(),
})
const explain = explainInvalid('That attention request is not valid.')

const caller = (c: Context): AttentionCaller => ({
  tenantId: tenantId(c),
  staffId: c.get('staffUserId'),
  role: c.get('staffRow').role,
  permissions: c.get('staffPermissions'),
})

const app = new Hono()
  .get('/summary', zValidator('query', summaryQuery, explain), async c =>
    c.json(await attentionSummary(caller(c), c.req.valid('query').location_id)),
  )
  .get('/', zValidator('query', listQuery, explain), async c => {
    const { limit_per_group } = c.req.valid('query')
    return c.json(await attentionPanel(caller(c), limit_per_group ? { limitPerGroup: limit_per_group } : {}))
  })

export default app
