import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getOwnClassDetail, getOwnPtSessionDetail } from '../../../services/schedule/detail'
import { searchClients } from '../../../services/clients/manage'
import { tenantId } from '../../../middleware/tenant'
import { requirePermission } from '../../../middleware/require-permission'
import { classDetailJson } from '../class-detail'
import { idParam } from '../parse'
import { ptSessionDetailJson } from '../pt-session-detail'

/**
 * The instructor's session page (spec-waitlist.md §10):
 *
 *   GET /sessions/class/:id/roster — a class the caller teaches: its seats and
 *                                    its roster, each row tagged with its seat.
 *                                    No pay figures. 403 `not_your_session` for
 *                                    anyone else's class.
 *   GET /sessions/pt/:id/roster    — a private session the caller runs: its
 *                                    members and the package paying each seat,
 *                                    whether it is manual (#338). No pay
 *                                    figures. 403 `not_your_session` otherwise.
 *   GET /clients?q=               — find a member to add to the roster.
 *
 * The roster read is what an Instructor needs to teach and is ungated; the
 * member search serves only Add member, so it is the **Manage rosters**
 * Instructor Permission (be/docs/adr/0012).
 */

const searchQuery = z.object({ q: z.string().trim().min(1).max(100) })

const app = new Hono()
  .get('/sessions/class/:id/roster', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const d = await getOwnClassDetail(tenantId(c), id, c.get('staffUserId'))
    return c.json(classDetailJson(d, { admin: false }))
  })
  .get('/sessions/pt/:id/roster', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const d = await getOwnPtSessionDetail(tenantId(c), id, c.get('staffUserId'))
    return c.json(ptSessionDetailJson(d, { admin: false }))
  })
  .get('/clients', requirePermission('manage_rosters'), zValidator('query', searchQuery), async c => {
    const rows = await searchClients(tenantId(c), c.req.valid('query').q)
    return c.json({ clients: rows.map(r => ({ id: r.id, name: r.name, email: r.email })) })
  })

export default app
