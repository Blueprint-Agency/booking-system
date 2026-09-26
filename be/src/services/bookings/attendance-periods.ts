/**
 * The calendar behind a member's "Your practice" summary (#317): which days a
 * timeframe covers, how it is cut into buckets, and which days it is compared
 * against.
 *
 *   - month:   the current calendar month, in weeks starting Monday.
 *   - quarter: the current month and the two before it, in weeks.
 *   - year:    the current calendar year, one bucket per month.
 *   - all:     one bucket per year, from the first attended class.
 *
 * A timeframe that does not start on a bucket boundary clips its first bucket
 * to its own first day — September 2026 starts on a Tuesday, so its first week
 * is 1–6 September — so no bucket ever counts a day outside the timeframe.
 *
 * The comparison is the equal-length period before: last month, the three
 * months before, last year. `all` has nothing before it.
 *
 * Everything is a plain date in the Tenant's own zone; turning one into an
 * instant is the caller's. Pure: no database, no clock. See
 * attendance-periods.test.ts.
 */
import { addDays, isoWeekday, type PlainDate } from '../schedule/series-dates'

export const ATTENDANCE_PERIODS = ['month', 'quarter', 'year', 'all'] as const
export type AttendancePeriod = (typeof ATTENDANCE_PERIODS)[number]

/** A run of days, both ends included. */
export interface DateSpan {
  from: PlainDate
  to: PlainDate
}

export interface AttendancePlan extends DateSpan {
  period: AttendancePeriod
  /** Each bucket's first day, ascending. A bucket runs to the day before the
   *  next one starts; the last runs to `to`. */
  buckets: PlainDate[]
  /** What `attended` is compared against; null for `all`. */
  previous: DateSpan | null
}

export interface DayCount {
  day: PlainDate
  attended: number
}

const firstOfMonth = (d: PlainDate): PlainDate => `${d.slice(0, 7)}-01`
const firstOfYear = (d: PlainDate): PlainDate => `${d.slice(0, 4)}-01-01`
const lastOfYear = (d: PlainDate): PlainDate => `${d.slice(0, 4)}-12-31`

/** The first of the month `months` after the one `first` opens. */
function addMonths(first: PlainDate, months: number): PlainDate {
  const index = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1 + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

/** `from`, then every Monday after it up to `to`. */
function weekStarts(from: PlainDate, to: PlainDate): PlainDate[] {
  const out = [from]
  for (let d = addDays(from, 8 - isoWeekday(from)); d <= to; d = addDays(d, 7)) out.push(d)
  return out
}

/** `from`, then the first of every month after it up to `to`. */
function monthStarts(from: PlainDate, to: PlainDate): PlainDate[] {
  const out = [from]
  for (let d = addMonths(firstOfMonth(from), 1); d <= to; d = addMonths(d, 1)) out.push(d)
  return out
}

/** `from`, then every 1 January after it up to `to`. */
function yearStarts(from: PlainDate, to: PlainDate): PlainDate[] {
  const out = [from]
  for (let y = Number(from.slice(0, 4)) + 1; `${y}-01-01` <= to; y++) out.push(`${y}-01-01`)
  return out
}

/** The span of `months` calendar months ending with the one before `first`. */
const monthsBefore = (first: PlainDate, months: number): DateSpan => ({
  from: addMonths(first, -months),
  to: addDays(first, -1),
})

/**
 * The timeframe `period` names on `today`. `firstAttendedOn` — the day of the
 * member's first attended class, if any — is read only by `all`; a member who
 * has attended nothing gets this year alone.
 */
export function attendancePlan(
  period: AttendancePeriod,
  today: PlainDate,
  firstAttendedOn: PlainDate | null,
): AttendancePlan {
  const month = firstOfMonth(today)
  const monthEnd = addDays(addMonths(month, 1), -1)
  switch (period) {
    case 'month':
      return { period, from: month, to: monthEnd, buckets: weekStarts(month, monthEnd), previous: monthsBefore(month, 1) }
    case 'quarter': {
      const from = addMonths(month, -2)
      return { period, from, to: monthEnd, buckets: weekStarts(from, monthEnd), previous: monthsBefore(from, 3) }
    }
    case 'year': {
      const from = firstOfYear(today)
      const to = lastOfYear(today)
      return { period, from, to, buckets: monthStarts(from, to), previous: monthsBefore(from, 12) }
    }
    case 'all': {
      const from = firstAttendedOn ?? firstOfYear(today)
      const to = lastOfYear(today)
      return { period, from, to, buckets: yearStarts(from, to), previous: null }
    }
  }
}

/** Each of the plan's buckets with the attendance on its days. Days outside
 *  the plan are left out. */
export function bucketCounts(plan: AttendancePlan, days: readonly DayCount[]): { startsOn: PlainDate; attended: number }[] {
  const counts = plan.buckets.map(startsOn => ({ startsOn, attended: 0 }))
  for (const { day, attended } of days) {
    if (day < plan.from || day > plan.to) continue
    let i = counts.length - 1
    while (counts[i]!.startsOn > day) i--
    counts[i]!.attended += attended
  }
  return counts
}

/** The attendance on the days of `span`. */
export function attendedWithin(span: DateSpan, days: readonly DayCount[]): number {
  return days.reduce((sum, d) => (d.day >= span.from && d.day <= span.to ? sum + d.attended : sum), 0)
}
