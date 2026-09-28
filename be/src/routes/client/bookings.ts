import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { bookClass, serializePaidWith } from '../../services/bookings/book'
import { cancelBooking } from '../../services/bookings/cancel'
import { previewMemberClassCancel } from '../../services/bookings/cancel-preview'
import { listClassBookings, getClassBookingDetail, type ClassBookingRow } from '../../services/bookings/list'
import { memberAttendance } from '../../services/bookings/attendance'
import { ATTENDANCE_PERIODS } from '../../services/bookings/attendance-periods'
import { isIsoDate } from '../../services/tenants/term-dates'
import { tenantId } from '../../middleware/tenant'

function bookingRow(b: ClassBookingRow) {
  return {
    booking_id: b.bookingId,
    class_id: b.classId,
    name: b.name,
    instructor: b.instructor,
    location: b.location,
    room: b.room,
    starts_at: b.startsAt.toISOString(),
    ends_at: b.endsAt.toISOString(),
    credit_cost: b.creditCost,
    credits_used: b.creditsUsed,
    package_kind: b.packageKind,
    was_unlimited: b.wasUnlimited,
    check_in_state: b.checkInState,
    state: b.state,
    qr_token: b.qrToken,
    code: b.code,
    effective_cancel_window_hours: b.effectiveCancelWindowHours,
    cancel_deadline: b.cancelDeadline.toISOString(),
  }
}

const app = new Hono()
  .get('/upcoming', async c => {
    const clientId = c.get('clientId')
    const rows = await listClassBookings(tenantId(c), clientId, 'upcoming')
    return c.json({ bookings: rows.map(bookingRow) })
  })
  .get('/past', async c => {
    const clientId = c.get('clientId')
    const rows = await listClassBookings(tenantId(c), clientId, 'past')
    return c.json({ bookings: rows.map(bookingRow) })
  })
  .get(
    '/attendance',
    zValidator(
      'query',
      z.object({
        period: z.enum(ATTENDANCE_PERIODS).default('month'),
        on: z.string().refine(isIsoDate, { message: 'a date like 2026-01-31' }).optional(),
      }),
    ),
    async c => {
      const clientId = c.get('clientId')
      const { period, on } = c.req.valid('query')
      const summary = await memberAttendance(tenantId(c), clientId, period, on)
      return c.json({
        period: summary.period,
        from: summary.from,
        to: summary.to,
        has_previous: summary.hasPrevious,
        has_next: summary.hasNext,
        attended: summary.attended,
        attended_classes: summary.attendedClasses,
        attended_pt: summary.attendedPt,
        attended_workshops: summary.attendedWorkshops,
        previous_attended: summary.previousAttended,
        buckets: summary.buckets.map(b => ({ starts_on: b.startsOn, attended: b.attended, booked: b.booked })),
        ...(summary.sessions && {
          sessions: summary.sessions.map(s => ({
            kind: s.kind,
            name: s.name,
            starts_at: s.startsAt.toISOString(),
            status: s.status,
          })),
        }),
        minutes: summary.minutes,
        streak_weeks: summary.streakWeeks,
        usual_slot: summary.usualSlot,
        top_class_types: summary.topClassTypes,
        lifetime: summary.lifetime,
        last_attended_at: summary.lastAttendedAt?.toISOString() ?? null,
      })
    },
  )
  .get('/:id', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const clientId = c.get('clientId')
    const { id } = c.req.valid('param')
    const row = await getClassBookingDetail(tenantId(c), clientId, id)
    const preview = await previewMemberClassCancel(tenantId(c), clientId, row)
    return c.json({
      ...bookingRow(row),
      cancel_preview: preview && {
        late: preview.late,
        credit_back: preview.creditBack,
        credits: preview.credits,
        unlimited: preview.unlimited,
      },
    })
  })
  .post(
    '/class',
    zValidator(
      'json',
      // Strict: `use_credits` is gone (be/docs/adr/0010), and a client still
      // sending it gets a 400 rather than a booking it did not ask for.
      z.object({ class_id: z.string().uuid(), client_package_id: z.string().uuid().optional() }).strict(),
    ),
    async c => {
      const clientId = c.get('clientId')
      const { class_id, client_package_id } = c.req.valid('json')
      const res = await bookClass(tenantId(c), {
        clientId,
        classId: class_id,
        clientPackageId: client_package_id ?? null,
      })
      return c.json(
        {
          booking_id: res.bookingId,
          qr_token: res.qrToken,
          code: res.code,
          paid_with: serializePaidWith(res.paidWith),
        },
        201,
      )
    },
  )
  .delete('/:id', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const clientId = c.get('clientId')
    const { id } = c.req.valid('param')
    const res = await cancelBooking(tenantId(c), { bookingId: id, source: 'client', clientId })
    return c.json({ refund_outcome: res.refundOutcome, refund_fired: res.refundFired })
  })

export default app
