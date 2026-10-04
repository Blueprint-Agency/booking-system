/**
 * A member's own practice summary (#317, "My practice" #340): the sessions
 * they attended in a timeframe — group classes and private sessions — laid out
 * by day, week, month or year, against the timeframe before it, with what they
 * are booked into and not checked in, time on the mat, weeks in a row, their usual slot and
 * their lifetime total. See be-client.md §3 and `./attendance-periods.ts` for
 * the calendar.
 *
 * Counted from `bookings` by `check_in_state = 'attended'`, not from
 * `check_ins`: imported history (a studio migrated from another system)
 * arrives as bookings with the outcome already written and no check-in row, and
 * it counts like anything ticked here. A class booking takes its class's times,
 * a private session booking its PT session's. Workshops are counted on a line
 * of their own, on their first day, and never in `attended`; corporate sessions
 * are not bookings at all.
 *
 * Booked is a confirmed booking of an active session not checked in: one still
 * to come, and one whose session has started without a tick (no job marks a
 * no-show; staff do), so the member sees what they held and was never marked.
 * A no-show is neither attended nor booked.
 *
 * Days and hours are the Tenant's own, and now is the shared clock's.
 */
import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { now } from '../../lib/clock'
import { AppError, NotFoundError } from '../../shared/errors'
import { addDays, localDateOf, zonedInstant, type PlainDate } from '../schedule/series-dates'
import { loadTenantById } from '../tenants/tenants'
import {
  anchorRefusal,
  attendancePlan,
  attendedWithin,
  bucketCounts,
  longestRunWeeks,
  periodSteps,
  streakWeeks,
  usualSlot,
  type AttendancePeriod,
  type BucketCount,
  type DateSpan,
  type DayCount,
  type UsualSlot,
} from './attendance-periods'

const TOP_CLASS_TYPES = 3

/** A session in a week: attended, or booked and not checked in. */
export interface PracticeSession {
  kind: 'class' | 'pt'
  /** The class type's name; "Private session" for a private session. */
  name: string
  startsAt: Date
  status: 'attended' | 'booked'
}

export interface MemberAttendance {
  period: AttendancePeriod
  from: PlainDate
  to: PlainDate
  /** An earlier timeframe the member can step back to, and a later one up to today's. */
  hasPrevious: boolean
  hasNext: boolean
  /** Group classes and private sessions attended in the timeframe. */
  attended: number
  attendedClasses: number
  attendedPt: number
  /** Workshops attended in the timeframe, by their first day. Not in `attended`. */
  attendedWorkshops: number
  /** The equal-length timeframe before; null for `all`. */
  previousAttended: number | null
  buckets: BucketCount[]
  /** `week` alone: every session attended or booked in it, oldest first. */
  sessions: PracticeSession[] | null
  /** Minutes of the sessions attended in the timeframe. */
  minutes: number
  /** Consecutive Monday weeks with a session attended, up to this week (or
   *  last); for a timeframe that has ended, the longest such run inside it. */
  streakWeeks: number
  usualSlot: UsualSlot | null
  /** The most-attended class types in the timeframe, most first, the name breaking a tie. Classes only. */
  topClassTypes: { name: string; attended: number }[]
  /** Every class and private session ever attended, and the day of the first. */
  lifetime: { attended: number; since: PlainDate | null }
  /** The start of the member's most recent attended session, in any timeframe. */
  lastAttendedAt: Date | null
}

/** The member's attended sessions grouped by their start's day and hour on the Tenant's calendar. */
type AttendedRow = {
  day: PlainDate
  hour: number
  kind: 'class' | 'pt'
  sessions: number
  minutes: number
  last_at: string | Date
}

const within = (span: DateSpan, day: PlainDate) => day >= span.from && day <= span.to

/** A span of plain dates as the half-open instant range it covers in `timezone`. */
function instants(span: DateSpan, timezone: string) {
  return {
    from: zonedInstant(span.from, '00:00', timezone).toISOString(),
    until: zonedInstant(addDays(span.to, 1), '00:00', timezone).toISOString(),
  }
}

/**
 * The member's class and private-session bookings with their session's times,
 * as a subquery with `kind`, `name` (the class type's, or "Private session"),
 * `state`, `check_in_state`, `lifecycle`, `starts_at` and `ends_at`.
 */
const memberSessions = (tenantId: string, clientId: string) => sql`(
  select b.kind, ct.name, b.state, b.check_in_state, c.lifecycle, c.starts_at, c.ends_at
  from bookings b
  join classes c on c.tenant_id = b.tenant_id and c.id = b.class_id
  join class_types ct on ct.tenant_id = c.tenant_id and ct.id = c.class_type_id
  where b.tenant_id = ${tenantId}::uuid and b.client_id = ${clientId}::uuid and b.kind = 'class'
  union all
  select b.kind, 'Private session', b.state, b.check_in_state, p.lifecycle, p.starts_at, p.ends_at
  from bookings b
  join pt_sessions p on p.tenant_id = b.tenant_id and p.id = b.pt_session_id
  where b.tenant_id = ${tenantId}::uuid and b.client_id = ${clientId}::uuid and b.kind = 'pt'
)`

/** Booked: a confirmed booking of an active session not checked in, whether or not it has started. */
const booked = sql`s.state = 'confirmed' and s.lifecycle = 'active' and s.check_in_state = 'pending'`

/**
 * The practice summary for the timeframe `period` containing the day `on`
 * (today when not given). An `on` past the timeframe containing today, or
 * before the year of the member's first attended session, is refused `422`.
 */
export async function memberAttendance(
  tenantId: string,
  clientId: string,
  period: AttendancePeriod,
  on?: PlainDate,
): Promise<MemberAttendance> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found')
  const timezone = tenant.timezone
  const at = now()
  const today = localDateOf(at, timezone)

  // Every attended session ever: few enough rows (a day and hour each) to read
  // whole, and the lifetime, the streak and the first day all need them.
  const attended: AttendedRow[] = Array.from(
    await db.execute<AttendedRow>(sql`
      select to_char(s.starts_at at time zone ${timezone}, 'YYYY-MM-DD') as day,
             extract(hour from s.starts_at at time zone ${timezone})::int as hour,
             s.kind,
             count(*)::int as sessions,
             round(sum(extract(epoch from s.ends_at - s.starts_at)) / 60)::int as minutes,
             max(s.starts_at) as last_at
      from ${memberSessions(tenantId, clientId)} s
      where s.check_in_state = 'attended'
      group by 1, 2, 3
    `),
  )
  const firstDay = attended.reduce<PlainDate | null>((min, r) => (min === null || r.day < min ? r.day : min), null)

  const anchor = on ?? today
  const refusal = anchorRefusal(period, anchor, today, firstDay)
  if (refusal) throw new AppError(422, refusal, { period, on: anchor })

  const plan = attendancePlan(period, anchor, firstDay)
  const shown = instants(plan, timezone)
  const current = within(plan, today)

  const [bookedDays, types, workshops, sessions] = await Promise.all([
    db.execute<{ day: PlainDate; booked: number }>(sql`
      select to_char(s.starts_at at time zone ${timezone}, 'YYYY-MM-DD') as day, count(*)::int as booked
      from ${memberSessions(tenantId, clientId)} s
      where ${booked}
        and s.starts_at >= ${shown.from}::timestamptz
        and s.starts_at < ${shown.until}::timestamptz
      group by 1
    `),
    db.execute<{ name: string; attended: number }>(sql`
      select ct.name, count(*)::int as attended
      from bookings b
      join classes c on c.tenant_id = b.tenant_id and c.id = b.class_id
      join class_types ct on ct.tenant_id = c.tenant_id and ct.id = c.class_type_id
      where b.tenant_id = ${tenantId}::uuid
        and b.client_id = ${clientId}::uuid
        and b.kind = 'class'
        and b.check_in_state = 'attended'
        and c.starts_at >= ${shown.from}::timestamptz
        and c.starts_at < ${shown.until}::timestamptz
      group by ct.name
      order by attended desc, ct.name asc
      limit ${TOP_CLASS_TYPES}
    `),
    db.execute<{ attended: number }>(sql`
      select count(*)::int as attended
      from bookings b
      cross join lateral (
        select min(d.starts_at) as starts_at from workshop_days d
        where d.tenant_id = b.tenant_id and d.workshop_id = b.workshop_id
      ) w
      where b.tenant_id = ${tenantId}::uuid
        and b.client_id = ${clientId}::uuid
        and b.kind = 'workshop'
        and b.check_in_state = 'attended'
        and w.starts_at >= ${shown.from}::timestamptz
        and w.starts_at < ${shown.until}::timestamptz
    `),
    period === 'week'
      ? db.execute<{ kind: 'class' | 'pt'; name: string; starts_at: string | Date; attended: boolean }>(sql`
          select s.kind, s.name, s.starts_at, s.check_in_state = 'attended' as attended
          from ${memberSessions(tenantId, clientId)} s
          where (s.check_in_state = 'attended' or (${booked}))
            and s.starts_at >= ${shown.from}::timestamptz
            and s.starts_at < ${shown.until}::timestamptz
          order by s.starts_at, s.name
        `)
      : null,
  ])

  const days = new Map<PlainDate, DayCount>()
  const dayOf = (day: PlainDate) => days.get(day) ?? days.set(day, { day, attended: 0, booked: 0 }).get(day)!
  for (const r of attended) dayOf(r.day).attended += r.sessions
  for (const r of bookedDays) dayOf(r.day).booked = r.booked
  const dayCounts = [...days.values()]

  const inPlan = attended.filter(r => within(plan, r.day))
  const attendedDays = attended.map(r => r.day)
  const count = (rows: AttendedRow[]) => rows.reduce((n, r) => n + r.sessions, 0)
  const lastAt = attended.reduce<Date | null>((max, r) => {
    const t = new Date(r.last_at)
    return max === null || t > max ? t : max
  }, null)

  return {
    period,
    from: plan.from,
    to: plan.to,
    ...periodSteps(plan, today, firstDay),
    attended: attendedWithin(plan, dayCounts),
    attendedClasses: count(inPlan.filter(r => r.kind === 'class')),
    attendedPt: count(inPlan.filter(r => r.kind === 'pt')),
    attendedWorkshops: workshops[0]?.attended ?? 0,
    previousAttended: plan.previous ? attendedWithin(plan.previous, dayCounts) : null,
    buckets: bucketCounts(plan, dayCounts),
    sessions:
      sessions &&
      Array.from(sessions).map(s => ({
        kind: s.kind,
        name: s.name,
        startsAt: new Date(s.starts_at),
        status: s.attended ? 'attended' : 'booked',
      })),
    minutes: inPlan.reduce((n, r) => n + r.minutes, 0),
    streakWeeks: current ? streakWeeks(today, attendedDays) : longestRunWeeks(plan, attendedDays),
    usualSlot: usualSlot(inPlan.flatMap(r => Array.from({ length: r.sessions }, () => ({ day: r.day, hour: r.hour })))),
    topClassTypes: Array.from(types).map(t => ({ name: t.name, attended: t.attended })),
    lifetime: { attended: count(attended), since: firstDay },
    lastAttendedAt: lastAt,
  }
}
