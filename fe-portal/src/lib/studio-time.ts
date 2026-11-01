/**
 * The studio's clock: every calendar day, wall-clock time and day boundary the
 * staff portal shows, types in or decides on is read in the studio's own IANA
 * zone, never the browser's. This is the one module that turns between instants
 * and that clock; `formatters.ts` and `local-day.ts` are thin layers over it,
 * and every date and time on screen goes through one of the three.
 *
 * The zone is always an argument. It comes from the slug lookup the proxy makes
 * (`Tenant.timezone`), through the brand object the root layout provides
 * (`useStudioZone`). Nothing here has a default and nothing reads the runtime's
 * own zone, so a missing zone is a bug that shows rather than a quietly wrong
 * day, and the same input reads the same for an admin travelling abroad, a
 * Platform administrator acting as a studio, and the tests.
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
/** The furthest instant a `Date` can hold. */
const MAX_DATE_MS = 8.64e15;

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

/** The Monday of the week `date` falls in. */
export function startOfWeek(date: PlainDate): PlainDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** The first of the month `date` falls in. */
export function startOfMonth(date: PlainDate): PlainDate {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the month `date` falls in. */
export function endOfMonth(date: PlainDate): PlainDate {
  const [y, m] = date.split("-").map(Number);
  return isoDay(Date.UTC(y!, m!, 0));
}

/**
 * `date` moved by whole calendar months, clamped to the last day of the target
 * month (31 January plus a month is 28 February).
 */
export function addMonths(date: PlainDate, months: number): PlainDate {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDay(Date.UTC(year, month, Math.min(d!, last)));
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

/** Minutes since local midnight of `instant` in `timezone` (0–1439). */
export function minutesIntoDay(timezone: string, instant: Instant): number {
  const [h, m] = localClock(timezone, instant).split(":").map(Number);
  return h! * 60 + m!;
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
  // Typed text that is no date, or one past the range a `Date` holds, has no
  // instant: NaN, which a caller reads as "not a valid date and time".
  if (!Number.isFinite(wall) || Math.abs(wall) > MAX_DATE_MS - 2 * MS_PER_DAY) return NaN;
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

// ── The studio's zone, required and checked ────────────────────────────────

/**
 * Whether this runtime knows the zone. An older WebView lacks newer IANA names
 * (`America/Ciudad_Juarez`), and every formatter then throws; the brand
 * provider asks once, before anything formats, so the screen can say so rather
 * than go blank.
 */
export function isKnownZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The studio's zone, or an error: outside a studio (the super portal's own
 * hostname, a context with no provider) there is no clock, and nothing may
 * quietly format in UTC or in the browser's zone.
 */
export function requireStudioZone(timezone: string | null): string {
  if (timezone === null) throw new Error("No studio is resolved, so there is no studio time zone to read dates in.");
  return timezone;
}

// ── Formatting ─────────────────────────────────────────────────────────────

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Fields {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // Sunday 0
  hour: number;
  minute: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function fieldsOfWall(wallUtc: number): Fields {
  const d = new Date(wallUtc);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/**
 * Lays fields out in a date-fns style pattern (English, the layout the portal
 * has always printed): `yyyy`, `MMMM`, `MMM`, `MM`, `M`, `EEEEE`, `EEEE`,
 * `EEE`, `dd`, `d`, `HH`, `hh`, `h`, `mm` and `a` (AM/PM); text in single
 * quotes is literal. A token it does not know throws, so a new layout is a bug
 * that shows rather than a quietly wrong string.
 */
function layout(f: Fields, pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i]!;
    if (ch === "'") {
      const end = pattern.indexOf("'", i + 1);
      const stop = end === -1 ? pattern.length : end;
      out += pattern.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) {
      out += ch;
      i++;
      continue;
    }
    let run = 1;
    while (pattern[i + run] === ch) run++;
    const hour12 = f.hour % 12 === 0 ? 12 : f.hour % 12;
    switch (ch.repeat(run)) {
      case "yyyy":
        out += String(f.year).padStart(4, "0");
        break;
      case "MMMM":
        out += MONTHS[f.month - 1];
        break;
      case "MMM":
        out += MONTHS[f.month - 1]!.slice(0, 3);
        break;
      case "MM":
        out += pad2(f.month);
        break;
      case "M":
        out += f.month;
        break;
      case "EEEEE":
        out += WEEKDAYS[f.weekday]![0];
        break;
      case "EEEE":
        out += WEEKDAYS[f.weekday];
        break;
      case "EEE":
        out += WEEKDAYS[f.weekday]!.slice(0, 3);
        break;
      case "dd":
        out += pad2(f.day);
        break;
      case "d":
        out += f.day;
        break;
      case "HH":
        out += pad2(f.hour);
        break;
      case "hh":
        out += pad2(hour12);
        break;
      case "h":
        out += hour12;
        break;
      case "mm":
        out += pad2(f.minute);
        break;
      case "a":
        out += f.hour < 12 ? "AM" : "PM";
        break;
      default:
        throw new Error(`Unsupported date pattern token "${ch.repeat(run)}" in "${pattern}"`);
    }
    i += run;
  }
  return out;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * An `Intl` formatter fixed to the studio's zone, one cached per zone, locale
 * and options, for a layout the pattern tokens below cannot spell (the locale's
 * own "4:00 pm"). The zone is what is shared; the locale and the layout are the
 * caller's.
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

/** An instant laid out on the studio's clock, in a date-fns style pattern. */
export function formatInZone(timezone: string, instant: Instant, pattern: string): string {
  return layout(fieldsOfWall(wallClockAsUtc(timezone, toMs(instant))), pattern);
}

/**
 * A plain date laid out in a date-fns style pattern. It names a day, not a
 * moment, so there is no clock to convert and no zone to pass: reading it in a
 * zone would move it by the zone's offset. Time-of-day tokens read midnight.
 */
export function formatPlain(date: PlainDate, pattern: string): string {
  return layout(fieldsOfWall(asUtcMidnight(date)), pattern);
}
