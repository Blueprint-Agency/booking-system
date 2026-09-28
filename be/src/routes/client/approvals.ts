import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { listUnseenApprovals, markApprovalSeen } from '../../services/approvals/unseen'
import { tenantId } from '../../middleware/tenant'

/**
 * The member's approved PT and Corporate Requests they have yet to see: the
 * app celebrates each once, then marks it seen (fe-client-features.md §11.2).
 */
const app = new Hono()
  .get('/', async c => {
    const rows = await listUnseenApprovals(tenantId(c), c.get('clientId'))
    return c.json({
      approvals: rows.map(r => ({
        kind: r.kind,
        id: r.id,
        title: r.title,
        session_type: r.sessionType,
        starts_at: r.startsAt.toISOString(),
        ends_at: r.endsAt.toISOString(),
        location_name: r.locationName,
        location_address: r.locationAddress,
        location_gmaps_url: r.locationGmapsUrl,
        instructor_name: r.instructorName,
        approved_at: r.approvedAt?.toISOString() ?? null,
      })),
    })
  })
  .post(
    '/:kind/:id/seen',
    zValidator('param', z.object({ kind: z.enum(['pt', 'corporate']), id: z.string().uuid() })),
    async c => {
      // An admin acting as the member sees the celebration, but it stays the
      // member's own to see: nothing is cleared on their behalf.
      if (!c.get('impersonatedBy')) {
        const { kind, id } = c.req.valid('param')
        await markApprovalSeen(tenantId(c), c.get('clientId'), kind, id)
      }
      return c.body(null, 204)
    },
  )

export default app
