import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  listCheckInDay,
  markAttendance,
  scanCheckIn,
  type CheckInDay,
  type CheckInSource,
  type ScanCheckInResult,
} from '../../services/bookings/check-in'
import { BadRequestError } from '../../shared/errors'
import { tenantId } from '../../middleware/tenant'

/**
 * The check-in surface (#192), mounted twice: at `/admin/check-in` and at
 * `/instructor/check-in`. The two differ only in `source`, and what that
 * changes — an instructor reaches their own sessions only — is decided in the
 * service, so the two mounts cannot drift.
 */

// Exactly one of the two: the token a QR encodes, or the code printed under it.
const scanBody = z
  .object({ qr_token: z.string().min(1).max(200).optional(), code: z.string().min(1).max(40).optional() })
  .refine(b => (b.qr_token === undefined) !== (b.code === undefined))

const refuseScanBody = (result: { success: boolean }) => {
  if (!result.success) {
    throw new BadRequestError('bad_request', { message: 'Scan a QR code or type a booking code.' })
  }
}

function scanView(r: ScanCheckInResult) {
  return {
    outcome: r.outcome,
    message: r.message,
    booking_id: r.bookingId,
    method: r.method,
    member: r.member,
    session: {
      kind: r.session.kind,
      id: r.session.id,
      name: r.session.name,
      starts_at: r.session.startsAt.toISOString(),
      location: r.session.location,
    },
  }
}

function dayView(d: CheckInDay) {
  return {
    date: d.date,
    opens_minutes_before: d.opensMinutesBefore,
    sessions: d.sessions.map(s => ({
      kind: s.kind,
      id: s.id,
      name: s.name,
      starts_at: s.startsAt.toISOString(),
      ends_at: s.endsAt.toISOString(),
      check_in_opens_at: s.checkInOpensAt.toISOString(),
      location: s.location,
      room: s.room,
      instructor: s.instructor,
      roster: s.roster.map(r => ({
        booking_id: r.bookingId,
        client_id: r.clientId,
        name: r.name,
        code: r.code,
        state: r.state,
        check_in_state: r.checkInState,
        method: r.method,
        checked_in_at: r.checkedInAt?.toISOString() ?? null,
        seat: r.seat,
        promoted_from_waitlist: r.promotedFromWaitlist,
      })),
      waitlist: s.waitlist.map(w => ({
        entry_id: w.entryId,
        client_id: w.clientId,
        name: w.name,
        position: w.position,
      })),
    })),
  }
}

export function checkInRoutes(source: CheckInSource) {
  return new Hono()
    .get('/', zValidator('query', z.object({ location_id: z.string().uuid().optional() })), async c => {
      const { location_id } = c.req.valid('query')
      const day = await listCheckInDay(tenantId(c), {
        staffId: c.get('staffUserId'),
        source,
        ...(location_id ? { locationId: location_id } : {}),
      })
      return c.json(dayView(day))
    })
    .post('/scan', zValidator('json', scanBody, refuseScanBody), async c => {
      const { qr_token, code } = c.req.valid('json')
      const res = await scanCheckIn(tenantId(c), {
        ...(qr_token !== undefined ? { qrToken: qr_token } : { code: code! }),
        staffId: c.get('staffUserId'),
        source,
      })
      c.set('auditTarget' as any, { table: 'bookings', id: res.bookingId })
      return c.json(scanView(res))
    })
    .post(
      '/manual',
      zValidator('json', z.object({ booking_id: z.string().uuid(), attended: z.boolean().default(true) })),
      async c => {
        const { booking_id, attended } = c.req.valid('json')
        const res = await markAttendance(tenantId(c), {
          bookingId: booking_id,
          staffId: c.get('staffUserId'),
          attended,
          source,
        })
        c.set('auditTarget' as any, { table: 'bookings', id: booking_id })
        return c.json({ check_in_state: res.checkInState })
      },
    )
}
