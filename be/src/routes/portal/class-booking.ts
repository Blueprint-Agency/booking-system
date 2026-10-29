import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { z } from 'zod'
import { staffBookClass, staffPackagesForClass } from '../../services/bookings/book'
import type { StaffRole } from '../../services/waitlist/staff'
import { tenantId } from '../../middleware/tenant'
import { staffBookingJson, staffBookingSchema, staffPackagesJson, staffPackagesQuery } from './class-seats'
import { idParam } from './parse'
import type { Surface } from './surface'

/**
 * A staff member books a member onto a class from the session page, beside the
 * class waitlist (`./class-waitlist.ts`), mounted under `/schedule` by both the
 * Admin and the Instructor portal. The role is the mount's, never the body's;
 * an Instructor reaches only the classes they teach (the service checks).
 *
 *   GET  /classes/:id/packages  — the member's class packages for this class,
 *                                 each Eligible or with its reason: what Add
 *                                 member's package select lists (#333).
 *   POST /classes/:id/bookings  — a free online seat, else a buffer seat, else
 *                                 (Admin only) an overbook seat when both are
 *                                 full and the Admin said so (spec-waitlist.md
 *                                 §7), paid by the package picked or the
 *                                 Default payer.
 *
 * The two surfaces differ in `overbook`: the Admin's is honoured and an
 * Instructor never overbooks, so theirs is read and not passed on.
 */
const SURFACES: Record<
  Surface,
  { role: StaffRole; overbook: (b: z.infer<typeof staffBookingSchema>) => { overbook?: boolean } }
> = {
  admin: { role: 'admin', overbook: b => ({ overbook: b.overbook }) },
  instructor: { role: 'instructor', overbook: () => ({}) },
}

export function classBookingRoutes(surface: Surface) {
  const { role, overbook } = SURFACES[surface]
  return new Hono()
    .get('/classes/:id/packages', zValidator('param', idParam), zValidator('query', staffPackagesQuery), async c => {
      const { id } = c.req.valid('param')
      const res = await staffPackagesForClass(tenantId(c), {
        classId: id,
        clientId: c.req.valid('query').client_id,
        role,
        actorStaffId: c.get('staffUserId'), // never from the query
      })
      return c.json(staffPackagesJson(res))
    })
    .post('/classes/:id/bookings', zValidator('param', idParam), zValidator('json', staffBookingSchema), async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const res = await staffBookClass(tenantId(c), {
        classId: id,
        clientId: body.client_id,
        role,
        actorStaffId: c.get('staffUserId'), // never from the body
        ...overbook(body),
        clientPackageId: body.client_package_id ?? null,
        allowClash: body.allow_clash ?? false,
      })
      c.set('auditTarget', { table: 'bookings', id: res.bookingId })
      if (body.allow_clash) c.set('auditDetail', { allow_clash: true })
      return c.json(staffBookingJson(res), 201)
    })
}
