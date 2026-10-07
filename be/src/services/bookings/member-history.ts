/**
 * A member's bookings as the studio sees them — the portal's customer detail
 * page (admin-restructure.md § Customers). Not the member's own list
 * (`list.ts`), which shows classes only and hides what was cancelled: the front
 * desk wants every kind — class, private session, workshop — and wants a late
 * cancel or a no-show on the record, because those are the conversations it has.
 *
 *   - upcoming:  still booked, starting from now, soonest first.
 *   - past:      held — started before now and not cancelled (attended, no-show,
 *                or never ticked) — most recent first, capped.
 *   - cancelled: cancelled, whatever its start time, from the moment it is
 *                cancelled, newest cancellation first, capped; each with the
 *                shared cancellation summary (`cancellation-summary.ts`, #352).
 *                A private-session request withdrawn or expired while pending
 *                had no booking, and is listed here too.
 *
 * Imported history (a studio migrated from another system) arrives as ordinary
 * bookings with their check-in state and refund outcome already written, so it
 * reads here like anything booked on the platform.
 */
import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { now as clockNow } from '../../lib/clock'
import { cancelWindowResolver } from '../policy/cancel-window'
import { staffCancelPreview, type StaffCancelPreview } from './staff-cancel-preview'
import type { CancellationSource } from '../../db/enums'
import {
  cancellationRecord,
  pendingRequestEnd,
  summarizeCancellation,
  type CancellationFacts,
  type CancellationSummary,
} from './cancellation-summary'
import { ptSessionCost } from '../pt-sessions/cost'

export type MemberBookingKind = 'class' | 'workshop' | 'pt'

export interface MemberBookingRow {
  bookingId: string
  kind: MemberBookingKind
  /** Class type, workshop name, or null for a private session (the portal names it). */
  title: string | null
  /** The workshop tier bought; null for everything else. */
  tierName: string | null
  /** '1on1' | '2on1' on a private session; null otherwise. */
  sessionType: '1on1' | '2on1' | null
  /** First day's start for a workshop tier. Null only if the session row is gone. */
  startsAt: Date | null
  endsAt: Date | null
  location: string | null
  instructor: string | null
  state: 'confirmed' | 'cancelled' | 'no_show'
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  /** What a cancellation did with the credit: returned, refunded, forfeited (a late cancel). */
  refundOutcome: 'credit_returned' | 'session_returned' | 'stripe_refunded' | 'forfeited' | 'n_a'
  creditsUsed: number | null
  /** The package that paid for it, by name; null for a workshop (its own purchase). */
  packageName: string | null
  /** That package's kind — `unlimited` spends no credit. Null when no package paid. */
  packageKind: string | null
  /** What the staff cancel dialog asks from; null where no cancel is offered (#320). */
  cancelPreview: StaffCancelPreview | null
  code: string
  bookedAt: Date
  cancelledAt: Date | null
}

type Raw = {
  booking_id: string
  kind: MemberBookingKind
  title: string | null
  tier_name: string | null
  session_type: '1on1' | '2on1' | null
  starts_at: string | Date | null
  ends_at: string | Date | null
  location: string | null
  instructor: string | null
  state: MemberBookingRow['state']
  check_in_state: MemberBookingRow['checkInState']
  refund_outcome: MemberBookingRow['refundOutcome']
  credits_used: number | null
  package_name: string | null
  package_kind: string | null
  cancel_window_hours: number | null
  code: string
  booked_at: string | Date
  cancelled_at: string | Date | null
  record_source: CancellationSource | null
  record_within_window: boolean | null
  record_within_cap: boolean | null
  record_cancelled_at: string | Date | null
  record_staff_name: string | null
  workshop_cancelled: boolean | null
  workshop_cancelled_by: string | null
}

export interface MemberCancelledRow extends Omit<MemberBookingRow, 'bookingId' | 'code'> {
  /** Null on a private-session request withdrawn or expired while pending: it never had a booking. */
  bookingId: string | null
  ptRequestId: string | null
  code: string | null
  cancellation: CancellationSummary
}

const toDate = (v: string | Date | null): Date | null => (v === null ? null : new Date(v))

export const PAST_BOOKINGS_LIMIT = 50

/**
 * One read per scope. The when-is-it column is a coalesce across the three
 * kinds, so the scope filter and the order are applied to it rather than to any
 * one table's column. Bounded by the member's own bookings
 * (`bookings_client_booked_idx`), which is a few hundred rows at the most.
 */
export async function listMemberBookings(
  tenantId: string,
  clientId: string,
  scope: 'upcoming' | 'past',
  limit = scope === 'past' ? PAST_BOOKINGS_LIMIT : 100,
): Promise<MemberBookingRow[]> {
  return (await readBookings(tenantId, clientId, scope, limit)).map(r => r.row)
}

/**
 * The member's cancellations, newest first: every cancelled booking of every
 * kind (corporate stays on the corporate requests page), and every
 * private-session request withdrawn or expired while still pending, each with
 * the shared summary of who cancelled and where the credit went.
 */
export async function listCancelledMemberBookings(
  tenantId: string,
  clientId: string,
  limit = PAST_BOOKINGS_LIMIT,
): Promise<MemberCancelledRow[]> {
  const [booked, requests] = await Promise.all([
    readBookings(tenantId, clientId, 'cancelled', limit),
    withdrawnPtRequests(tenantId, clientId, limit),
  ])
  const rows: MemberCancelledRow[] = [
    ...booked.map(({ row, raw }) => ({
      ...row,
      ptRequestId: null,
      cancellation: summarizeCancellation({
        kind: raw.kind,
        refundOutcome: raw.refund_outcome,
        creditsUsed: raw.credits_used ?? 0,
        bookingCancelledAt: toDate(raw.cancelled_at),
        record: cancellationRecord({
          source: raw.record_source,
          wasWithinWindow: raw.record_within_window,
          wasWithinCap: raw.record_within_cap,
          cancelledAt: raw.record_cancelled_at,
          staffName: raw.record_staff_name,
        }),
        by: workshopCanceller(raw),
      }),
    })),
    ...requests,
  ]
  const at = (r: MemberCancelledRow) => r.cancellation.cancelledAt?.getTime() ?? -Infinity
  return rows.sort((a, b) => at(b) - at(a)).slice(0, limit)
}

/**
 * Who cancelled a workshop place. It is never given a `cancellations` row, so
 * its own facts say: a place cancelled with its Workshop is the staff member
 * who cancelled the Workshop; one cancelled by a Refund's unwind is the
 * studio's machinery. Anything else is the studio's, unnamed.
 */
function workshopCanceller(r: Raw): CancellationFacts['by'] {
  if (r.kind !== 'workshop') return undefined
  if (r.workshop_cancelled) {
    return { actor: r.workshop_cancelled_by ? 'staff' : 'studio', staffName: r.workshop_cancelled_by }
  }
  return { actor: r.refund_outcome === 'stripe_refunded' ? 'automatic' : 'studio' }
}

/**
 * Private-session requests withdrawn or expired while pending: a pending
 * request holds its sessions but has no booking, so it reads as a cancellation
 * of its own. Pending always returns the sessions it held. Who, and whether
 * it expired: `pendingRequestEnd`.
 */
async function withdrawnPtRequests(tenantId: string, clientId: string, limit: number): Promise<MemberCancelledRow[]> {
  const rows = await db.execute<{
    id: string
    session_type: '1on1' | '2on1'
    location: string | null
    package_name: string | null
    package_kind: string | null
    debited: boolean
    created_at: string | Date
    resolved_at: string | Date | null
    expires_at: string | Date | null
    cancel_source: CancellationSource | null
    resolved_by_staff_id: string | null
    staff_name: string | null
  }>(sql`
    select
      r.id,
      r.session_type,
      l.name as location,
      pk.name as package_name,
      cp.kind as package_kind,
      r.debited_client_package_id is not null as debited,
      r.created_at,
      r.resolved_at,
      r.expires_at,
      r.cancel_source,
      r.resolved_by_staff_id,
      s.name as staff_name
    from pt_requests r
    left join locations l on l.id = r.location_id and l.tenant_id = r.tenant_id
    left join client_packages cp on cp.id = r.debited_client_package_id and cp.tenant_id = r.tenant_id
    left join pt_packages pk on pk.id = cp.source_pt_package_id and pk.tenant_id = r.tenant_id
    left join staff_users s on s.id = r.resolved_by_staff_id and s.tenant_id = r.tenant_id
    where r.tenant_id = ${tenantId}::uuid
      and r.client_id = ${clientId}::uuid
      and r.status = 'cancelled_before_scheduled'
    order by r.resolved_at desc nulls last
    limit ${limit}
  `)
  return Array.from(rows).map(r => {
    const resolvedAt = toDate(r.resolved_at)
    const credits = r.debited ? ptSessionCost(r.session_type) : 0
    const refundOutcome = r.debited ? 'session_returned' : 'n_a'
    return {
      bookingId: null,
      ptRequestId: r.id,
      kind: 'pt',
      title: null,
      tierName: null,
      sessionType: r.session_type,
      startsAt: null,
      endsAt: null,
      location: r.location,
      instructor: null,
      state: 'cancelled',
      checkInState: 'n_a',
      refundOutcome,
      creditsUsed: credits,
      packageName: r.package_name,
      packageKind: r.package_kind,
      cancelPreview: null,
      code: null,
      bookedAt: new Date(r.created_at),
      cancelledAt: resolvedAt,
      cancellation: summarizeCancellation({
        kind: 'pt',
        refundOutcome,
        creditsUsed: credits,
        bookingCancelledAt: resolvedAt,
        record: null,
        ...pendingRequestEnd({
          cancelSource: r.cancel_source,
          resolvedByStaffId: r.resolved_by_staff_id,
          staffName: r.staff_name,
          expiresAt: toDate(r.expires_at),
          resolvedAt,
        }),
      }),
    }
  })
}

/**
 * One read per scope. The when-is-it column is a coalesce across the three
 * kinds, so the scope filter and the order are applied to it rather than to any
 * one table's column. Bounded by the member's own bookings
 * (`bookings_client_booked_idx`), which is a few hundred rows at the most.
 */
async function readBookings(
  tenantId: string,
  clientId: string,
  scope: 'upcoming' | 'past' | 'cancelled',
  limit: number,
): Promise<{ row: MemberBookingRow; raw: Raw }[]> {
  const when = sql.raw('coalesce(c.starts_at, ps.starts_at, wd.starts_at)')
  const scopeCond = {
    upcoming: sql`b.state = 'confirmed' and ${when} >= now()`,
    past: sql`${when} < now() and b.state <> 'cancelled'`,
    cancelled: sql`b.state = 'cancelled'`,
  }[scope]
  const order = {
    upcoming: sql`${when} asc nulls last, b.booked_at asc`,
    past: sql`${when} desc nulls last, b.booked_at desc`,
    cancelled: sql`coalesce(x.cancelled_at, b.cancelled_at) desc nulls last, ${when} desc nulls last`,
  }[scope]

  const rows = await db.execute<Raw>(sql`
    select
      b.id as booking_id,
      b.kind,
      case b.kind when 'class' then ct.name when 'workshop' then w.name else null end as title,
      wt.name as tier_name,
      ps.session_type,
      ${when} as starts_at,
      coalesce(c.ends_at, ps.ends_at, wd.ends_at) as ends_at,
      coalesce(lc.name, lp.name, lw.name) as location,
      coalesce(ic.name, ip.name) as instructor,
      b.state,
      b.check_in_state,
      b.refund_outcome,
      b.credits_or_sessions_used as credits_used,
      coalesce(cpk.name, ppk.name) as package_name,
      cp.kind as package_kind,
      c.cancel_window_hours,
      b.code,
      b.booked_at,
      b.cancelled_at,
      x.source as record_source,
      x.was_within_window as record_within_window,
      x.was_within_cap as record_within_cap,
      x.cancelled_at as record_cancelled_at,
      xs.name as record_staff_name,
      w.lifecycle = 'cancelled' as workshop_cancelled,
      ws.name as workshop_cancelled_by
    from bookings b
    left join classes c on c.id = b.class_id
    left join class_types ct on ct.id = c.class_type_id
    left join pt_sessions ps on ps.id = b.pt_session_id
    left join workshops w on w.id = b.workshop_id
    left join workshop_tiers wt on wt.id = b.workshop_tier_id
    left join lateral (
      select min(d.starts_at) as starts_at, max(d.ends_at) as ends_at
      from workshop_tier_days td
      join workshop_days d on d.id = td.workshop_day_id
      where td.workshop_tier_id = b.workshop_tier_id
    ) wd on b.kind = 'workshop'
    left join locations lc on lc.id = c.location_id
    left join locations lp on lp.id = ps.location_id
    left join locations lw on lw.id = w.location_id
    left join staff_users ic on ic.id = c.main_instructor_id
    left join staff_users ip on ip.id = ps.instructor_id
    left join client_packages cp on cp.id = b.client_package_id
    left join class_packages cpk on cpk.id = cp.source_class_package_id
    left join pt_packages ppk on ppk.id = cp.source_pt_package_id
    left join cancellations x on x.booking_id = b.id and x.tenant_id = b.tenant_id
    left join staff_users xs on xs.id = x.cancelled_by_staff_id
    left join staff_users ws on ws.id = w.cancelled_by_staff_id
    where b.tenant_id = ${tenantId}::uuid
      and b.client_id = ${clientId}::uuid
      and ${scopeCond}
    order by ${order}
    limit ${limit}
  `)

  const windowOf = await cancelWindowResolver(tenantId)
  const now = clockNow()
  return Array.from(rows).map(r => {
    const row = {
      bookingId: r.booking_id,
      kind: r.kind,
      title: r.title,
      tierName: r.tier_name,
      sessionType: r.session_type,
      startsAt: toDate(r.starts_at),
      endsAt: toDate(r.ends_at),
      location: r.location,
      instructor: r.instructor,
      state: r.state,
      checkInState: r.check_in_state,
      refundOutcome: r.refund_outcome,
      creditsUsed: r.credits_used,
      packageName: r.package_name,
      packageKind: r.package_kind,
      code: r.code,
      bookedAt: new Date(r.booked_at),
      cancelledAt: toDate(r.cancelled_at),
    }
    return {
      raw: r,
      row: {
        ...row,
        cancelPreview: staffCancelPreview(row, windowOf({ cancelWindowHours: r.cancel_window_hours }), now),
      },
    }
  })
}

/**
 * The member's attendance at a glance: what they turned up to, missed and
 * cancelled late, over every booking they have ever had here. Counted in the
 * database so the numbers do not depend on how much history the page lists.
 */
export interface AttendanceSummary {
  attended: number
  noShows: number
  lateCancels: number
  lastAttendedAt: Date | null
}

export async function memberAttendanceSummary(
  tenantId: string,
  clientId: string,
): Promise<AttendanceSummary> {
  const rows = await db.execute<{
    attended: number
    no_shows: number
    late_cancels: number
    last_attended_at: string | Date | null
  }>(sql`
    select
      count(*) filter (where b.check_in_state = 'attended')::int as attended,
      count(*) filter (where b.check_in_state = 'no_show' or b.state = 'no_show')::int as no_shows,
      -- A Late cancel is a class's (be/CONTEXT.md): a private session's forfeit is not one.
      count(*) filter (where b.kind = 'class' and b.state = 'cancelled' and b.refund_outcome = 'forfeited')::int as late_cancels,
      max(coalesce(c.starts_at, ps.starts_at, b.booked_at)) filter (where b.check_in_state = 'attended') as last_attended_at
    from bookings b
    left join classes c on c.id = b.class_id
    left join pt_sessions ps on ps.id = b.pt_session_id
    where b.tenant_id = ${tenantId}::uuid and b.client_id = ${clientId}::uuid
  `)
  const r = rows[0]
  return {
    attended: r?.attended ?? 0,
    noShows: r?.no_shows ?? 0,
    lateCancels: r?.late_cancels ?? 0,
    lastAttendedAt: toDate(r?.last_attended_at ?? null),
  }
}
