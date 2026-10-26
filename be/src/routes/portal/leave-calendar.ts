import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { leaveViewer, listLeaveCalendar } from '../../services/leave/requests'
import { explainInvalid } from '../explain-invalid'
import { plainDate } from '../plain-date'

/**
 * GET /api/v1/portal/leave-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Who is away, for everybody on staff. Mounted at the portal ROOT rather than in
 * the admin or instructor subtree because it is the one leave surface with no
 * role gate at all — the parent's staffAuth + requireActiveStaff is the
 * whole of its access control (see routes/portal/index.ts).
 *
 * What each caller may see is decided by the read itself: the service returns
 * `detail: null` for anyone else's leave when the caller is an instructor, so
 * the restricted fields are absent from the response body, not merely hidden by
 * the portal. This route only passes the caller's identity and role through.
 */

const app = new Hono().get(
  '/',
  zValidator(
    'query',
    z.object({ from: plainDate('A from date'), to: plainDate('A to date') }),
    explainInvalid('That calendar range is not valid.'),
  ),
  async c => {
    const { from, to } = c.req.valid('query')
    const leave = await listLeaveCalendar(leaveViewer(c.get('staffRow')), from, to)
    return c.json({ leave })
  },
)

export default app
