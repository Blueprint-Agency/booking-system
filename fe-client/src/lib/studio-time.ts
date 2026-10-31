/**
 * The studio's clock: every calendar day, wall-clock time and day boundary the
 * member app shows or decides on is read in the studio's own IANA zone, never
 * the device's and never a fixed Singapore offset. This is the one module that
 * turns between instants and that clock; every date and time on screen goes
 * through it.
 *
 * The zone is always an argument. It comes from the slug lookup the proxy makes
 * (`Tenant.timezone`), through the brand object the root layout provides
 * (`useStudioZone`). Nothing here has a default and nothing reads the runtime's
 * own zone, so a missing zone is a bug that shows rather than a quietly wrong
 * day, and the same input reads the same on the server, on a phone in another
 * country and in the tests.
 *
 * The rules are the backend's (`be/src/lib/studio-time.ts`), restated here
 * because the apps share no code:
 *
 *  - **A day** is the half-open window from local midnight up to the next local
 *    midnight, so 23 or 25 hours on a daylight-saving transition day.
 *  - **"N days ahead"** counts calendar days, never multiples of 24 hours.
 *  - **A wall time in a spring-forward gap** does not exist, and resolves one
 *    gap later (02:30 in a gap from 02:00 to 03:00 is 03:30).
 *  - **A wall time that occurs twice** at fall-back resolves to the first
 *    occurrence.
 *
 * Daylight saving is the zone's rules on the date in question, never a stored
 * offset: `Intl` is the only thing in the runtime that knows them.
 *
 * Imports nothing, so a pure rule module can depend on it freely.
 */

/** A calendar day, `YYYY-MM-DD`. Not an instant. */
export type PlainDate = string;

/** A wall-clock time, `HH:MM`. */
export type LocalTime = string;

/** ISO weekday: Monday 1 … Sunday 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** An instant: milliseconds since the epoch, an ISO string, or a `Date`. */
export type Instant = number | string | Date;

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

const toMs = (instant: Instant): number => (typeof instant === "number" ? instant : new Date(instant).getTime());
const asUtcMidnight = (d: PlainDate) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── Plain dates: calendar arithmetic needs no zone ─────────────────────────

/** `date` moved by whole calendar days. */
export function addDays(date: PlainDate, days: number): PlainDate {
  return isoDay(asUtcMidnight(date) + days * MS_PER_DAY);
}

/** Whole days between two plain dates; negative if `b` is before `a`. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  return Math.round((asUtcMidnight(b) - asUtcMidnight(a)) / MS_PER_DAY);
}

export function isoWeekday(date: PlainDate): IsoWeekday {
  const js = new Date(asUtcMidnight(date)).getUTCDay(); // Sunday 0
  return (js === 0 ? 7 : js) as IsoWeekday;
}

// ── Instants on the studio's clock ─────────────────────────────────────────

const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock fields of `instant` in `timezone`, read back as if they were UTC.
 *  Throws `RangeError` on a zone name the runtime does not know. */
function wallClockAsUtc(timezone: string, instant: number): number {
  let format = wallClockFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    wallClockFormats.set(timezone, format);
  }
  const parts = format.formatToParts(new Date(instant));
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/** The zone's offset from UTC at an instant, in milliseconds. */
const offsetAt = (timezone: string, instant: number) => wallClockAsUtc(timezone, instant) - instant;

/** The calendar day `instant` falls on in `timezone`. This is also "today", from
 *  any instant: `localDate(tz, Date.now())`. */
export function localDate(timezone: string, instant: Instant): PlainDate {
  return isoDay(wallClockAsUtc(timezone, toMs(instant)));
}

/** The wall-clock time of `instant` in `timezone`, `HH:MM` on the 24-hour clock. */
export function localClock(timezone: string, instant: Instant): LocalTime {
  return new Date(wallClockAsUtc(timezone, toMs(instant))).toISOString().slice(11, 16);
}

/**
 * The instant (milliseconds) at which it is `time` on `date` in `timezone`.
 *
 * A zone has one offset before a nearby change and one after it; the answer is
 * whichever of the two makes the wall time read back as asked. When both do
 * (the repeated hour at fall-back) the earlier instant wins; when neither does
 * (the skipped hour at spring-forward) the pre-change offset is used, which
 * lands the time one gap later.
 */
export function instantAt(timezone: string, date: PlainDate, time: LocalTime): number {
  const [hours, minutes] = time.split(":").map(Number);
  const wall = asUtcMidnight(date) + (hours! * 60 + minutes!) * MS_PER_MINUTE;
  // A change lies within a day and a half of the wall time at most; the offsets
  // either side of that window are the two this wall time can be at.
  const before = offsetAt(timezone, wall - 1.5 * MS_PER_DAY);
  const after = offsetAt(timezone, wall + 1.5 * MS_PER_DAY);
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((instant) => wallClockAsUtc(timezone, instant) === wall);
  if (candidates.length > 0) return Math.min(...candidates);
  return wall - before;
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
): { startsAt: number; endsAt: number } {
  return {
    startsAt: instantAt(timezone, startDate, "00:00"),
    endsAt: instantAt(timezone, addDays(endDate, 1), "00:00"),
  };
}

/** The calendar date `days` after today on the studio's clock ("N days ahead"). */
export function datePlus(timezone: string, days: number, now: Instant = Date.now()): PlainDate {
  return addDays(localDate(timezone, now), days);
}

/**
 * `instant` moved by whole calendar days, at the same wall-clock time. "A week
 * from now" is the same time of day a week later across a daylight-saving
 * change, not 168 hours later.
 */
export function plusCalendarDays(timezone: string, instant: Instant, days: number): number {
  return plusCalendar(timezone, toMs(instant), (date) => addDays(date, days));
}

/**
 * `instant` moved by whole calendar months, at the same wall-clock time. The
 * day of the month is kept where the target month has it and clamped to the
 * month's last day where not (31 January plus a month is the end of February).
 */
export function plusCalendarMonths(timezone: string, instant: Instant, months: number): number {
  return plusCalendar(timezone, toMs(instant), (date) => {
    const [y, m, d] = date.split("-").map(Number);
    const index = y! * 12 + (m! - 1) + months;
    const year = Math.floor(index / 12);
    const month = index - year * 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return isoDay(Date.UTC(year, month, Math.min(d!, lastDay)));
  });
}

function plusCalendar(timezone: string, instant: number, move: (date: PlainDate) => PlainDate): number {
  const wall = new Date(wallClockAsUtc(timezone, instant)).toISOString();
  const date = move(wall.slice(0, 10));
  // Whole minutes are placed through the zone; the seconds ride along unchanged.
  return instantAt(timezone, date, wall.slice(11, 16)) + (instant % MS_PER_MINUTE);
}

/**
 * Whole days from `from` to `to` on the studio's calendar: the calendar days
 * between them, less one when `to` has not yet reached `from`'s wall-clock time
 * on its last day. Three days later at 09:00 is 3; at 08:59, 2.
 */
export function wholeDaysBetween(timezone: string, from: Instant, to: Instant): number {
  const a = toMs(from);
  const b = toMs(to);
  if (b < a) return -wholeDaysBetween(timezone, b, a);
  const days = daysBetween(localDate(timezone, a), localDate(timezone, b));
  return days > 0 && localClock(timezone, b) < localClock(timezone, a) ? days - 1 : days;
}

// ── Formatting ─────────────────────────────────────────────────────────────

const formats = new Map<string, Intl.DateTimeFormat>();

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
  const key = `${timezone}|${locale}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone: timezone, ...options });
    formats.set(key, format);
  }
  return format;
}

/** The locale every member-facing date and time is laid out in. */
const LOCALE = "en-SG";

const inZone = (iso: Instant, timezone: string, options: Intl.DateTimeFormatOptions) =>
  zoneFormat(timezone, LOCALE, options).format(new Date(toMs(iso)));

/** "Thu, 12 Jun" — the day an instant falls on at the studio. */
export function formatDate(iso: Instant, timezone: string): string {
  return inZone(iso, timezone, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * "Tue, 24 Nov 2026" — for a package's expiry, which can be months out, so the
 * day and month alone leave the member guessing which year.
 */
export function formatExpiryDate(iso: Instant, timezone: string): string {
  return inZone(iso, timezone, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "4:00 pm" — the time of day an instant falls on at the studio. */
export function formatClassTime(iso: Instant, timezone: string): string {
  return inZone(iso, timezone, { hour: "numeric", minute: "2-digit", hour12: true });
}

/** "Thu, 12 Jun, 4:00 pm" — the day and time in one line, as the booking confirmation reads it. */
export function formatDayAndTime(iso: Instant, timezone: string): string {
  return inZone(iso, timezone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A plain date ("2026-10-01", or the first ten characters of an ISO string the
 * API sent for a date-only column) as "Thu, 1 Oct". It names a day, not a
 * moment, so there is no clock to convert and no zone to pass: reading it in a
 * zone would move it by the zone's offset.
 */
export function formatPlainDate(date: PlainDate): string {
  return zoneFormat("UTC", LOCALE, { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(asUtcMidnight(date)),
  );
}
