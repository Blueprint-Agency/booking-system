/**
 * Which classes a Class Series produces: the dates of one weekday in a range,
 * each at a wall-clock time in the Tenant's own zone.
 *
 * A series says "Mondays at 19:00", and that has to stay 19:00 across a
 * daylight-saving change — so an occurrence is computed from the plain date and
 * the local time through the zone's rules on that date, never by adding seven
 * days' worth of milliseconds to the previous one.
 *
 * Pure: no database, no clock. See series-dates.test.ts.
 */

/** A calendar day, `YYYY-MM-DD`. Not an instant. */
export type PlainDate = string

/** A wall-clock time, `HH:MM`. */
export type LocalTime = string

/** ISO weekday: Monday 1 … Sunday 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

const MS_PER_DAY = 86_400_000
const asUtcMidnight = (d: PlainDate) => Date.parse(`${d}T00:00:00Z`)

export function addDays(date: PlainDate, days: number): PlainDate {
  return new Date(asUtcMidnight(date) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Whole days from `a` to `b`; negative if `b` is before `a`. */
export function daysFrom(a: PlainDate, b: PlainDate): number {
  return Math.round((asUtcMidnight(b) - asUtcMidnight(a)) / MS_PER_DAY)
}

export function isoWeekday(date: PlainDate): IsoWeekday {
  const js = new Date(asUtcMidnight(date)).getUTCDay() // Sunday 0
  return (js === 0 ? 7 : js) as IsoWeekday
}

/** Every `weekday` from `from` to `to`, both inclusive, minus `excluded`. */
export function seriesDates(opts: {
  weekday: IsoWeekday
  from: PlainDate
  to: PlainDate
  excluded: readonly PlainDate[]
}): PlainDate[] {
  const skip = new Set(opts.excluded)
  const out: PlainDate[] = []
  let d = addDays(opts.from, (opts.weekday - isoWeekday(opts.from) + 7) % 7)
  while (d <= opts.to) {
    if (!skip.has(d)) out.push(d)
    d = addDays(d, 7)
  }
  return out
}

/** Wall-clock fields of `instant` in `timezone`, read back as if they were UTC. */
function wallClockAsUtc(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(p => p.type === type)?.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
}

/**
 * The instant at which it is `time` on `date` in `timezone`.
 *
 * `Intl` knows a zone's offset at an instant, not at a wall-clock time, so this
 * guesses with the offset at the wall time read as UTC and corrects once with
 * the offset at the guess — which settles on the right answer everywhere except
 * inside a spring-forward gap, where the time does not exist and the result
 * lands an hour later.
 */
export function zonedInstant(date: PlainDate, time: LocalTime, timezone: string): Date {
  const wall = Date.parse(`${date}T${time}:00Z`)
  const offsetAt = (instant: number) => wallClockAsUtc(instant, timezone) - instant
  const guess = wall - offsetAt(wall)
  return new Date(wall - offsetAt(guess))
}

/** The calendar day `instant` falls on in `timezone`. */
export function localDateOf(instant: Date, timezone: string): PlainDate {
  return new Date(wallClockAsUtc(instant.getTime(), timezone)).toISOString().slice(0, 10)
}

export interface Occurrence {
  date: PlainDate
  startsAt: Date
  endsAt: Date
}

/** `seriesDates`, each at `startTime`–`endTime` local time in `timezone`. */
export function seriesOccurrences(opts: {
  weekday: IsoWeekday
  startTime: LocalTime
  endTime: LocalTime
  from: PlainDate
  to: PlainDate
  excluded: readonly PlainDate[]
  timezone: string
}): Occurrence[] {
  return seriesDates(opts).map(date => ({
    date,
    startsAt: zonedInstant(date, opts.startTime, opts.timezone),
    endsAt: zonedInstant(date, opts.endTime, opts.timezone),
  }))
}
