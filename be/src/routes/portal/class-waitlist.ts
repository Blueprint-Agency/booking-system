import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { join } from '../../services/waitlist/entries'
import { staffPromote, staffRemove, type StaffRole } from '../../services/waitlist/staff'
import { now as clockNow } from '../../lib/clock'
import { tenantId } from '../../middleware/tenant'
import { staffBookingJson } from './class-seats'

/** Staff put a member in a full class's line. */
const staffJoinSchema = z.object({ client_id: z.string().uuid() })

/** Add to class. `overbook` is honoured for admins only. */
const staffPromoteSchema = z.object({ overbook: z.boolean().optional() })

const waitlistEntryParams = z.object({ id: z.string().uuid(), entryId: z.string().uuid() })

/**
 * A class's waitlist from the session page (spec-waitlist.md §7, §10), mounted
 * under `/schedule` by both the admin and the instructor portal. The role is
 * the mount's, never the body's; an instructor reaches only the classes they
 * teach (the service checks), and never overbooks.
 *
 *   POST   /classes/:id/waitlist                     — put a member in a full class's line
 *   POST   /classes/:id/waitlist/:entryId/promote    — Add to class
 *   DELETE /classes/:id/waitlist/:entryId            — Remove from the line
 */
export function classWaitlistRoutes(role: StaffRole) {
  return new Hono()
    .post(
      '/classes/:id/waitlist',
      zValidator('param', z.object({ id: z.string().uuid() })),
      zValidator('json', staffJoinSchema),
      async c => {
        const { id } = c.req.valid('param')
        const res = await join(tenantId(c), c.req.valid('json').client_id, id, clockNow(), {
          role,
          staffId: c.get('staffUserId'),
        })
        c.set('auditTarget' as any, { table: 'waitlist_entries', id: res.entryId })
        return c.json({ entry_id: res.entryId, position: res.position }, 201)
      },
    )
    .post(
      '/classes/:id/waitlist/:entryId/promote',
      zValidator('param', waitlistEntryParams),
      zValidator('json', staffPromoteSchema),
      async c => {
        const { id, entryId } = c.req.valid('param')
        const res = await staffPromote(tenantId(c), {
          classId: id,
          entryId,
          actor: { role, staffId: c.get('staffUserId') },
          // Honoured for admins only; the seat rule refuses an instructor's.
          overbook: c.req.valid('json').overbook,
        })
        c.set('auditTarget' as any, { table: 'bookings', id: res.bookingId })
        return c.json(staffBookingJson(res), 201)
      },
    )
    .delete('/classes/:id/waitlist/:entryId', zValidator('param', waitlistEntryParams), async c => {
      const { id, entryId } = c.req.valid('param')
      await staffRemove(tenantId(c), { classId: id, entryId, actor: { role, staffId: c.get('staffUserId') } })
      c.set('auditTarget' as any, { table: 'waitlist_entries', id: entryId })
      return c.body(null, 204)
    })
}
