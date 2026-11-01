/**
 * The period a date-range filter holds, and the instants it sends the API.
 *
 * Held as `YYYY-MM-DD` strings (what `<input type="date">` speaks); `null` is
 * "all time". Every preset ("today", "this week") and every instant is on the
 * studio's clock: the zone is an argument, from `useStudioZone()`, never the
 * browser's.
 */
import { localDay, localDayRange } from "./local-day";
import { addDays, addMonths, isoWeekday, startOfMonth } from "./studio-time";

export type DateRange = { from: string; to: string } | null;

export type PresetKey =
  | "today"
  | "week"
  | "7d"
  | "14d"
  | "30d"
  | "month"
  | "lastmonth"
  | "year"
  | "all";

/** The period a preset names, as the studio's calendar reads at `now`. */
export function presetRange(timezone: string, key: PresetKey, now: number | Date = Date.now()): DateRange {
  const today = localDay(timezone, now);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "week":
      // Weeks start Monday — the studio's timetable does, and a Sunday start
      // would put a Sunday class in "last week" the morning after it ran.
      return { from: addDays(today, 1 - isoWeekday(today)), to: today };
    case "7d":
    case "14d":
    case "30d": {
      const n = key === "7d" ? 7 : key === "14d" ? 14 : 30;
      return { from: addDays(today, -(n - 1)), to: today };
    }
    case "month":
      // Payroll is past-only, so ending "today" rather than end-of-month is
      // equivalent and reads more honestly.
      return { from: startOfMonth(today), to: today };
    case "lastmonth":
      // A closed month, so it runs to its own last day rather than to today.
      return { from: startOfMonth(addMonths(today, -1)), to: addDays(startOfMonth(today), -1) };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return null;
  }
}

/** The studio's midnight → ISO instants for the API's `from`/`to` query params. */
export function rangeToParams(
  timezone: string,
  r: DateRange,
): {
  from: string | undefined;
  to: string | undefined;
} {
  if (!r) return { from: undefined, to: undefined };
  return {
    from: localDayRange(timezone, r.from).start.toISOString(),
    to: localDayRange(timezone, r.to).end.toISOString(),
  };
}

export function sameRange(a: DateRange, b: DateRange): boolean {
  if (a === null || b === null) return a === b;
  return a.from === b.from && a.to === b.to;
}
