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

import {
  addDays,
  daysBetween,
  instantAt,
  isoWeekday,
  localDate,
  type IsoWeekday,
  type LocalTime,
  type PlainDate,
} from '../../lib/studio-time'

// The calendar arithmetic and the zone rules live in `lib/studio-time`; this
// module keeps the names its callers use.
export { addDays, isoWeekday }
export type { IsoWeekday, LocalTime, PlainDate }

/** Whole days from `a` to `b`; negative if `b` is before `a`. */
export const daysFrom = daysBetween

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

/**
 * The instant at which it is `time` on `date` in `timezone`: the studio-time
 * module's rule, with the zone last as this module's callers have always
 * passed it.
 */
export function zonedInstant(date: PlainDate, time: LocalTime, timezone: string): Date {
  return instantAt(timezone, date, time)
}

/** The calendar day `instant` falls on in `timezone`. */
export function localDateOf(instant: Date, timezone: string): PlainDate {
  return localDate(timezone, instant)
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
