import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { attentionPanel, attentionSummary, type AttentionCaller } from '../../services/attention'
import { isUpdatesCursor, markAllUpdatesRead, markUpdateRead } from '../../services/attention/updates'
import { requireRole } from '../../middleware/require-role'
import { dismissItem } from '../../services/attention/dismissals'
import { attentionKinds } from '../../services/attention/registry'
import { explainInvalid } from '../explain-invalid'

/**
 * /api/v1/portal/attention: what is waiting on the signed-in staff member, the
 * numbers behind the portal's bell and the list behind its panel.
 *
 * Mounted at the portal ROOT beside /leave, not in either role's subtree: both
 * roles read it, and what each is owed is decided per kind in the service from
 * the caller's role and Instructor Permissions, both re-resolved by `staffAuth`
 * on every request. The parent's staffAuth + requireActiveStaff is the access
 * control (routes/portal/index.ts). Outside the audit middleware's prefixes: the
 * only writes are a person marking their own updates read, which is no decision
 * worth an audit row.
 */
const summaryQuery = z.object({ location_id: z.string().uuid().optional() })
const listQuery = z.object({
  limit_per_group: z.coerce.number().int().min(1).max(50).optional(),
  // The Updates tab pages by this: the `next_cursor` of the page before.
  updates_before: z.string().max(100).refine(isUpdatesCursor, 'Not an updates cursor.').optional(),
})
// A known kind that cannot be dismissed still gets the service's 422 not_dismissable.
const dismissalBody = z.object({ kind: z.enum(attentionKinds), subject_id: z.string().uuid() })
const idParam =z.object({ id: z.string().uuid() })
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
    const { limit_per_group, updates_before } = c.req.valid('query')
    return c.json(
      await attentionPanel(caller(c), {
        ...(limit_per_group ? { limitPerGroup: limit_per_group } : {}),
        ...(updates_before ? { updatesBefore: updates_before } : {}),
      }),
    )
  })
  // An admin's studio-wide "do nothing is fine" on a dismissable item. The service
  // files its own audit row (this route is outside the audit prefixes).
  .post('/dismissals', requireRole('admin'), zValidator('json', dismissalBody, explain), async c => {
    const { kind, subject_id } = c.req.valid('json')
    await dismissItem(caller(c), { kind, subjectId: subject_id })
    return c.body(null, 204)
  })
  // Static before the :id route, or "read-all" would be read as an id.
  .post('/updates/read-all', async c => {
    await markAllUpdatesRead(caller(c))
    return c.body(null, 204)
  })
  .post('/updates/:id/read', zValidator('param', idParam, explain), async c => {
    await markUpdateRead(caller(c), c.req.valid('param').id)
    return c.body(null, 204)
  })

export default app
