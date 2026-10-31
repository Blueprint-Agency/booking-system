/**
 * The studio's clock: every calendar day, wall-clock time and day boundary the
 * system decides on is read in the studio's own IANA zone (`tenants.timezone`),
 * and this is the one module that turns between instants and that clock.
 *
 * Everything is stored as an instant or as a plain date; a human reads either on
 * the studio's clock. The zone is always an argument: nothing here has a
 * default, and nothing reads the process's own zone, so a missing zone is a bug
 * that shows rather than a quietly wrong day.
 *
 * Daylight saving is the zone's rules on the date in question, never a stored
 * offset (`Intl` is the only thing in the runtime that knows them):
 *
 *  - **A wall time in a spring-forward gap** does not exist, and resolves one
 *    gap later (02:30 in a gap from 02:00 to 03:00 is 03:30).
 *  - **A wall time that occurs twice** at fall-back resolves to the first
 *    occurrence.
 *  - **A day** is the half-open window from local midnight up to the next local
 *    midnight, so 23 or 25 hours long on a transition day.
 *  - **"N days ahead"** counts calendar days (`daysBetween` of two plain dates),
 *    never multiples of 24 hours.
 *
 * Imports nothing on purpose: a rule module can depend on this without gaining a
 * database, an env or a clock.
 */

/** A calendar day, `YYYY-MM-DD`. Not an instant. */
export type PlainDate = string

/** A wall-clock time, `HH:MM`. */
export type LocalTime = string

/** ISO weekday: Monday 1 … Sunday 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

const asUtcMidnight = (d: PlainDate) => Date.parse(`${d}T00:00:00Z`)

// ── Plain dates: calendar arithmetic needs no zone ─────────────────────────

/** `date` moved by whole calendar days. */
export function addDays(date: PlainDate, days: number): PlainDate {
  return new Date(asUtcMidnight(date) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Whole days between two plain dates; negative if `b` is before `a`. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  return Math.round((asUtcMidnight(b) - asUtcMidnight(a)) / MS_PER_DAY)
}

export function isoWeekday(date: PlainDate): IsoWeekday {
  const js = new Date(asUtcMidnight(date)).getUTCDay() // Sunday 0
  return (js === 0 ? 7 : js) as IsoWeekday
}

// ── Instants on the studio's clock ─────────────────────────────────────────

const wallClockFormats = new Map<string, Intl.DateTimeFormat>()

/** Wall-clock fields of `instant` in `timezone`, read back as if they were UTC.
 *  Throws `RangeError` on a zone name the runtime does not know. */
function wallClockAsUtc(timezone: string, instant: number): number {
  let format = wallClockFormats.get(timezone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    wallClockFormats.set(timezone, format)
  }
  const parts = format.formatToParts(new Date(instant))
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
}

/** The zone's offset from UTC at an instant, in milliseconds. */
const offsetAt = (timezone: string, instant: number) => wallClockAsUtc(timezone, instant) - instant

/** The calendar day `instant` falls on in `timezone`. This is also "today", from
 *  any instant: `localDate(tz, now)`. */
export function localDate(timezone: string, instant: Date): PlainDate {
  return new Date(wallClockAsUtc(timezone, instant.getTime())).toISOString().slice(0, 10)
}

/**
 * The instant at which it is `time` on `date` in `timezone`.
 *
 * A zone has one offset before a nearby change and one after it; the answer is
 * whichever of the two makes the wall time read back as asked. When both do
 * (the repeated hour at fall-back) the earlier instant wins; when neither does
 * (the skipped hour at spring-forward) the pre-change offset is used, which
 * lands the time one gap later.
 */
export function instantAt(timezone: string, date: PlainDate, time: LocalTime): Date {
  const [hours, minutes] = time.split(':').map(Number)
  const wall = asUtcMidnight(date) + (hours! * 60 + minutes!) * MS_PER_MINUTE
  // A change lies within a day and a half of the wall time at most; the offsets
  // either side of that window are the two this wall time can be at.
  const before = offsetAt(timezone, wall - 1.5 * MS_PER_DAY)
  const after = offsetAt(timezone, wall + 1.5 * MS_PER_DAY)
  const candidates = [...new Set([before, after])]
    .map(offset => wall - offset)
    .filter(instant => wallClockAsUtc(timezone, instant) === wall)
  if (candidates.length > 0) return new Date(Math.min(...candidates))
  return new Date(wall - before)
}

/**
 * A run of calendar days as a half-open instant window: the start of
 * `startDate` up to the start of the day AFTER `endDate`, so it never bleeds
 * into the adjacent day. `endDate` defaults to a single day.
 */
export function dayWindow(
  timezone: string,
  startDate: PlainDate,
  endDate: PlainDate = startDate,
): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: instantAt(timezone, startDate, '00:00'),
    endsAt: instantAt(timezone, addDays(endDate, 1), '00:00'),
  }
}

/**
 * `instant` moved by whole calendar days, at the same wall-clock time. "A week
 * from now" is the same time of day a week later across a daylight-saving
 * change, not 168 hours later.
 */
export function plusCalendarDays(timezone: string, instant: Date, days: number): Date {
  const wall = wallClockAsUtc(timezone, instant.getTime())
  const moved = new Date(wall + days * MS_PER_DAY)
  const date = moved.toISOString().slice(0, 10)
  const time = moved.toISOString().slice(11, 16)
  // Whole minutes are placed through the zone; the seconds ride along unchanged.
  return new Date(instantAt(timezone, date, time).getTime() + (instant.getTime() % MS_PER_MINUTE))
}

// ── Formatting ─────────────────────────────────────────────────────────────

const formats = new Map<string, Intl.DateTimeFormat>()

/**
 * An instant formatter fixed to the studio's zone, one cached per zone, locale
 * and options. The zone is what is shared; the locale and the layout are the
 * caller's, because they legitimately differ.
 */
export function zoneFormat(
  timezone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${timezone}|${locale}|${JSON.stringify(options)}`
  let format = formats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone: timezone, ...options })
    formats.set(key, format)
  }
  return format
}
