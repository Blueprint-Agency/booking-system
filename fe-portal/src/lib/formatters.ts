import { format, formatDistanceToNow, parseISO } from "date-fns";
import { localDay } from "./local-day";

export function formatSgd(amount: number): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatDate(iso: string, fmt = "EEE d MMM"): string {
  return format(parseISO(iso), fmt);
}

export function formatTime(iso: string): string {
  return format(parseISO(iso), "h:mma").toLowerCase();
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), "EEE d MMM, h:mma").replace(/(AM|PM)/, (m) => m.toLowerCase());
}

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

/** Today's local date as `yyyy-MM-dd`, for use as the `min` of a date input. */
export function todayIso(): string {
  return localDay();
}

/**
 * Current local hour as `HH:mm` with minutes pinned to `00`, optionally offset
 * by whole hours. Used to seed empty `<input type="time">` fields so the native
 * picker defaults to the top of the hour instead of the current wall-clock minute.
 */
export function currentHourTime(offsetHours = 0): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  return format(d, "HH:mm");
}

export function formatDuration(startsAt: string, endsAt: string): string {
  const ms = parseISO(endsAt).getTime() - parseISO(startsAt).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}
