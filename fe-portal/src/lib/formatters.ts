import { formatDistanceToNow, parseISO } from "date-fns";
import { localDay } from "./local-day";
import { formatInZone, formatPlain, localClock } from "./studio-time";

export function formatSgd(amount: number): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** A bare `YYYY-MM-DD` (a date column, a birthday) names a day, not a moment. */
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An instant as a date, on the studio's clock (`timezone` is the studio's IANA
 * zone, from `useStudioZone()`; never the browser's). A bare `YYYY-MM-DD` is a
 * plain day and reads as that day in any zone.
 */
export function formatDate(timezone: string, iso: string, fmt = "EEE d MMM"): string {
  return PLAIN_DAY.test(iso) ? formatPlain(iso, fmt) : formatInZone(timezone, iso, fmt);
}

/** A plain day (`YYYY-MM-DD`) as text. It names a day, not a moment, so there is no zone. */
export function formatPlainDay(day: string, fmt = "EEE d MMM"): string {
  return formatPlain(day, fmt);
}

export function formatTime(timezone: string, iso: string): string {
  return formatInZone(timezone, iso, "h:mma").toLowerCase();
}

export function formatDateTime(timezone: string, iso: string): string {
  return formatInZone(timezone, iso, "EEE d MMM, h:mma").replace(/(AM|PM)/, (m) => m.toLowerCase());
}

/**
 * "3 days ago": how long ago, which is elapsed time and reads the same on any
 * clock, so it takes no zone.
 */
export function formatRelative(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

/**
 * The `max` of every date input: a browser lets a year run to six digits, and
 * the API takes only four.
 */
export const LATEST_DATE = "9999-12-31";

/**
 * The `min` of a date input that filters or records something that happened:
 * a browser accepts year 0001, and the API refuses a day whose start falls
 * before year 1 once the studio's offset is applied.
 */
export const EARLIEST_DATE = "1900-01-01";

/**
 * Whether a date input's value may become a filter's period. `min` and `max`
 * stop only the picker: a browser still fires `input` with 0001-01-01, or with
 * 0002-… and 0020-… on the way to typing a year, and with a six-digit year.
 * A four-digit `yyyy-MM-dd` compares as text, so the bounds are string compares.
 */
export function isFilterDay(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= EARLIEST_DATE && v <= LATEST_DATE;
}

/** Today on the studio's clock as `yyyy-MM-dd`, for use as the `min` of a date input. */
export function todayIso(timezone: string): string {
  return localDay(timezone);
}

/**
 * The studio's current hour as `HH:mm` with minutes pinned to `00`, optionally
 * offset by whole hours (wrapping past midnight). Used to seed empty
 * `<input type="time">` fields so the native picker defaults to the top of the
 * hour instead of the current wall-clock minute.
 */
export function currentHourTime(timezone: string, offsetHours = 0): string {
  const hour = Number(localClock(timezone, Date.now()).slice(0, 2));
  return `${String((((hour + offsetHours) % 24) + 24) % 24).padStart(2, "0")}:00`;
}

export function formatDuration(startsAt: string, endsAt: string): string {
  const ms = parseISO(endsAt).getTime() - parseISO(startsAt).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}
