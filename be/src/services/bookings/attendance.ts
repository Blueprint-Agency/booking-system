/**
 * A member's own "Your practice" summary (#317): the group classes they
 * attended in a timeframe, laid out by week, month or year, against the
 * timeframe before it. See be-client.md §3 and `./attendance-periods.ts` for
 * the calendar.
 *
 * Counted from `bookings` by `check_in_state = 'attended'`, not from
 * `check_ins`: imported history (a studio migrated from another system)
 * arrives as bookings with the outcome already written and no check-in row, and
 * it counts like anything ticked here. Private sessions and workshops are other
 * booking kinds and are left out; corporate sessions are not bookings at all.
 *
 * Days are the Tenant's own calendar days, and today is the shared clock's.
 */
import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { now } from '../../lib/clock'
import { NotFoundError } from '../../shared/errors'
import { addDays, localDateOf, zonedInstant, type PlainDate } from '../schedule/series-dates'
import { loadTenantById } from '../tenants/tenants'
import {
  attendancePlan,
  attendedWithin,
  bucketCounts,
  type AttendancePeriod,
  type DateSpan,
  type DayCount,
} from './attendance-periods'

const TOP_CLASS_TYPES = 3

export interface MemberAttendance {
  period: AttendancePeriod
  from: PlainDate
  to: PlainDate
  attended: number
  /** The equal-length timeframe before; null for `all`. */
  previousAttended: number | null
  buckets: { startsOn: PlainDate; attended: number }[]
  /** The most-attended class types in the timeframe, most first, the name breaking a tie. */
  topClassTypes: { name: string; attended: number }[]
  /** The start of the member's most recent attended class, in any timeframe. */
  lastAttendedAt: Date | null
}

const toDate = (v: string | Date | null): Date | null => (v === null ? null : new Date(v))

/** The member's attended group-class bookings, as a SQL condition on `b` and `c`. */
const attendedClasses = (tenantId: string, clientId: string) => sql`
  b.tenant_id = ${tenantId}::uuid
  and b.client_id = ${clientId}::uuid
  and b.kind = 'class'
  and b.check_in_state = 'attended'`

/** A span of plain dates as the half-open instant range it covers in `timezone`. */
function instants(span: DateSpan, timezone: string) {
  return {
    from: zonedInstant(span.from, '00:00', timezone).toISOString(),
    until: zonedInstant(addDays(span.to, 1), '00:00', timezone).toISOString(),
  }
}

export async function memberAttendance(
  tenantId: string,
  clientId: string,
  period: AttendancePeriod,
): Promise<MemberAttendance> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found')
  const timezone = tenant.timezone

  const [ever] = await db.execute<{ first_at: string | Date | null; last_at: string | Date | null }>(sql`
    select min(c.starts_at) as first_at, max(c.starts_at) as last_at
    from bookings b
    join classes c on c.id = b.class_id
    where ${attendedClasses(tenantId, clientId)}
  `)
  const firstAt = toDate(ever?.first_at ?? null)
  const lastAttendedAt = toDate(ever?.last_at ?? null)

  const plan = attendancePlan(period, localDateOf(now(), timezone), firstAt && localDateOf(firstAt, timezone))
  const counted = instants({ from: plan.previous?.from ?? plan.from, to: plan.to }, timezone)
  const shown = instants(plan, timezone)

  const [days, types] = await Promise.all([
    db.execute<{ day: string; attended: number }>(sql`
      select to_char(c.starts_at at time zone ${timezone}, 'YYYY-MM-DD') as day, count(*)::int as attended
      from bookings b
      join classes c on c.id = b.class_id
      where ${attendedClasses(tenantId, clientId)}
        and c.starts_at >= ${counted.from}::timestamptz
        and c.starts_at < ${counted.until}::timestamptz
      group by 1
    `),
    db.execute<{ name: string; attended: number }>(sql`
      select ct.name, count(*)::int as attended
      from bookings b
      join classes c on c.id = b.class_id
      join class_types ct on ct.id = c.class_type_id
      where ${attendedClasses(tenantId, clientId)}
        and c.starts_at >= ${shown.from}::timestamptz
        and c.starts_at < ${shown.until}::timestamptz
      group by ct.name
      order by attended desc, ct.name asc
      limit ${TOP_CLASS_TYPES}
    `),
  ])
  const dayCounts: DayCount[] = Array.from(days)

  return {
    period,
    from: plan.from,
    to: plan.to,
    attended: attendedWithin(plan, dayCounts),
    previousAttended: plan.previous ? attendedWithin(plan.previous, dayCounts) : null,
    buckets: bucketCounts(plan, dayCounts),
    topClassTypes: Array.from(types).map(t => ({ name: t.name, attended: t.attended })),
    lastAttendedAt,
  }
}
