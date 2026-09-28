/**
 * The calendar behind a member's practice summary (#317, "My practice" #340):
 * which days a timeframe covers, how it is cut into buckets, and which days it
 * is compared against — and the two figures read off the calendar, the weeks
 * in a row and the usual slot.
 *
 * Each timeframe is the one containing a day — today, or an earlier day the
 * member stepped back to (#342):
 *
 *   - week:    Monday to Sunday, a bucket per day.
 *   - month:   the calendar month, a bucket per day.
 *   - quarter: the month and the two before it, in weeks.
 *   - year:    the calendar year, one bucket per month.
 *   - all:     one bucket per year, from the first attended class.
 *
 * A member can step back no further than the year of their first attended
 * session (this year, when there is none), and forward no further than the
 * timeframe containing today.
 *
 * A timeframe that does not start on a bucket boundary clips its first bucket
 * to its own first day — July 2026 starts on a Wednesday, so a quarter from it
 * opens with the week of 1–5 July — so no bucket ever counts a day outside the
 * timeframe.
 *
 * The comparison is the equal-length period before: the week before, last
 * month, the three months before, last year. `all` has nothing before it.
 *
 * Everything is a plain date in the Tenant's own zone; turning one into an
 * instant is the caller's. Pure: no database, no clock. See
 * attendance-periods.test.ts.
 */
import { addDays, isoWeekday, type IsoWeekday, type PlainDate } from '../schedule/series-dates'

export const ATTENDANCE_PERIODS = ['week', 'month', 'quarter', 'year', 'all'] as const
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
  /** Sessions held on the day that have not started yet. */
  booked?: number
}

export interface BucketCount {
  startsOn: PlainDate
  attended: number
  booked: number
}

/** A start on the Tenant's calendar: its day and its hour, 0–23. */
export interface SessionStart {
  day: PlainDate
  hour: number
}

export interface UsualSlot {
  weekday: IsoWeekday
  hour: number
}

/** Fewer attended sessions than this make no habit. */
const USUAL_SLOT_MIN = 3

const firstOfMonth = (d: PlainDate): PlainDate => `${d.slice(0, 7)}-01`
const firstOfYear = (d: PlainDate): PlainDate => `${d.slice(0, 4)}-01-01`
const lastOfYear = (d: PlainDate): PlainDate => `${d.slice(0, 4)}-12-31`

/** The first of the month `months` after the one `first` opens. */
function addMonths(first: PlainDate, months: number): PlainDate {
  const index = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1 + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

/** The Monday that opens `d`'s week. */
const mondayOf = (d: PlainDate): PlainDate => addDays(d, 1 - isoWeekday(d))

/** Every day from `from` to `to`. */
function days(from: PlainDate, to: PlainDate): PlainDate[] {
  const out: PlainDate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
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
 * The timeframe `period` that contains the day `on`. `firstAttendedOn` — the
 * day of the member's first attended class, if any — is read only by `all`; a
 * member who has attended nothing gets this year alone.
 */
export function attendancePlan(
  period: AttendancePeriod,
  on: PlainDate,
  firstAttendedOn: PlainDate | null,
): AttendancePlan {
  const month = firstOfMonth(on)
  const monthEnd = addDays(addMonths(month, 1), -1)
  switch (period) {
    case 'week': {
      const from = mondayOf(on)
      const to = addDays(from, 6)
      return { period, from, to, buckets: days(from, to), previous: { from: addDays(from, -7), to: addDays(from, -1) } }
    }
    case 'month':
      return { period, from: month, to: monthEnd, buckets: days(month, monthEnd), previous: monthsBefore(month, 1) }
    case 'quarter': {
      const from = addMonths(month, -2)
      return { period, from, to: monthEnd, buckets: weekStarts(from, monthEnd), previous: monthsBefore(from, 3) }
    }
    case 'year': {
      const from = firstOfYear(on)
      const to = lastOfYear(on)
      return { period, from, to, buckets: monthStarts(from, to), previous: monthsBefore(from, 12) }
    }
    case 'all': {
      const from = firstAttendedOn ?? firstOfYear(on)
      const to = lastOfYear(on)
      return { period, from, to, buckets: yearStarts(from, to), previous: null }
    }
  }
}

/** The first day a member may look at: 1 January of the year they first
 *  attended, or of this year when they never have. */
const earliestDay = (today: PlainDate, firstAttendedOn: PlainDate | null): PlainDate =>
  firstOfYear(firstAttendedOn ?? today)

export type AnchorRefusal = 'period_in_future' | 'period_before_first_year'

/**
 * Why the timeframe `period` containing `on` cannot be shown, or null when it
 * can: `on` is past the end of the one containing today, or before the year of
 * the member's first attended session.
 */
export function anchorRefusal(
  period: AttendancePeriod,
  on: PlainDate,
  today: PlainDate,
  firstAttendedOn: PlainDate | null,
): AnchorRefusal | null {
  if (on > attendancePlan(period, today, firstAttendedOn).to) return 'period_in_future'
  if (on < earliestDay(today, firstAttendedOn)) return 'period_before_first_year'
  return null
}

/**
 * Whether there is a timeframe to step back to (the day before this one opens
 * is not before the member's first year) and one to step forward to (this one
 * ends before today). `all` has neither.
 */
export function periodSteps(
  plan: AttendancePlan,
  today: PlainDate,
  firstAttendedOn: PlainDate | null,
): { hasPrevious: boolean; hasNext: boolean } {
  if (plan.previous === null) return { hasPrevious: false, hasNext: false }
  return {
    hasPrevious: addDays(plan.from, -1) >= earliestDay(today, firstAttendedOn),
    hasNext: plan.to < today,
  }
}

/** Each of the plan's buckets with the sessions attended and booked on its
 *  days. Days outside the plan are left out. */
export function bucketCounts(plan: AttendancePlan, dayCounts: readonly DayCount[]): BucketCount[] {
  const counts = plan.buckets.map(startsOn => ({ startsOn, attended: 0, booked: 0 }))
  for (const { day, attended, booked = 0 } of dayCounts) {
    if (day < plan.from || day > plan.to) continue
    let i = counts.length - 1
    while (counts[i]!.startsOn > day) i--
    counts[i]!.attended += attended
    counts[i]!.booked += booked
  }
  return counts
}

/**
 * The run of consecutive Monday weeks, each with at least one of `attendedDays`,
 * that ends with `today`'s week — or with last week, while this week has
 * nothing in it yet, so a streak does not break on a Monday morning.
 */
export function streakWeeks(today: PlainDate, attendedDays: readonly PlainDate[]): number {
  const weeks = new Set(attendedDays.map(mondayOf))
  let week = mondayOf(today)
  if (!weeks.has(week)) week = addDays(week, -7)
  let run = 0
  for (; weeks.has(week); week = addDays(week, -7)) run++
  return run
}

/**
 * The longest run of consecutive Monday weeks with at least one of
 * `attendedDays` inside `span` — the streak figure for a timeframe that has
 * ended. A week the span's edge cuts through counts by its days inside.
 */
export function longestRunWeeks(span: DateSpan, attendedDays: readonly PlainDate[]): number {
  const weeks = [...new Set(attendedDays.filter(d => d >= span.from && d <= span.to).map(mondayOf))].sort()
  let longest = 0
  let run = 0
  weeks.forEach((week, i) => {
    run = i > 0 && addDays(weeks[i - 1]!, 7) === week ? run + 1 : 1
    longest = Math.max(longest, run)
  })
  return longest
}

/**
 * The weekday and start hour the member most often attends at; null under
 * three sessions. A tie goes to the earliest weekday, Monday first, then the
 * earliest hour.
 */
export function usualSlot(starts: readonly SessionStart[]): UsualSlot | null {
  if (starts.length < USUAL_SLOT_MIN) return null
  const tally = new Map<number, number>()
  for (const { day, hour } of starts) {
    const slot = isoWeekday(day) * 24 + hour
    tally.set(slot, (tally.get(slot) ?? 0) + 1)
  }
  let best = -1
  let bestCount = 0
  for (const [slot, count] of tally) {
    if (count > bestCount || (count === bestCount && slot < best)) {
      best = slot
      bestCount = count
    }
  }
  return { weekday: Math.floor(best / 24) as IsoWeekday, hour: best % 24 }
}

/** The attendance on the days of `span`. */
export function attendedWithin(span: DateSpan, days: readonly DayCount[]): number {
  return days.reduce((sum, d) => (d.day >= span.from && d.day <= span.to ? sum + d.attended : sum), 0)
}
