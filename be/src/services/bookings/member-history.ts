/**
 * A member's bookings as the studio sees them — the portal's customer detail
 * page (admin-restructure.md § Customers). Not the member's own list
 * (`list.ts`), which shows classes only and hides what was cancelled: the front
 * desk wants every kind — class, private session, workshop — and wants a late
 * cancel or a no-show on the record, because those are the conversations it has.
 *
 *   - upcoming: still booked, starting from now, soonest first.
 *   - past:     started before now, in any state, most recent first, capped.
 *
 * Imported history (a studio migrated from another system) arrives as ordinary
 * bookings with their check-in state and refund outcome already written, so it
 * reads here like anything booked on the platform.
 */
import { sql } from 'drizzle-orm'
import { db } from '../../db'

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
  code: string
  booked_at: string | Date
  cancelled_at: string | Date | null
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
  const when = sql.raw('coalesce(c.starts_at, ps.starts_at, wd.starts_at)')
  const scopeCond =
    scope === 'upcoming'
      ? sql`b.state = 'confirmed' and ${when} >= now()`
      : sql`${when} < now()`
  const order = scope === 'upcoming' ? sql.raw('asc') : sql.raw('desc')

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
      b.code,
      b.booked_at,
      b.cancelled_at
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
    where b.tenant_id = ${tenantId}::uuid
      and b.client_id = ${clientId}::uuid
      and ${scopeCond}
    order by ${when} ${order} nulls last, b.booked_at ${order}
    limit ${limit}
  `)

  return Array.from(rows).map(r => ({
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
  }))
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
      count(*) filter (where b.state = 'cancelled' and b.refund_outcome = 'forfeited')::int as late_cancels,
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
