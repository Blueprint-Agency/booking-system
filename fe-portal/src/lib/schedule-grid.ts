/**
 * Where the admin timetable's day, week and month grids put things: which
 * calendar days a view spans, which instants to ask the API for, which day an
 * event falls on and how far down its column it sits.
 *
 * All of it is on the studio's clock. A day is the studio's midnight to the
 * next midnight (23 or 25 hours on a daylight-saving change), so a late class
 * sits under the right header and a 00:30 one is not drawn at the foot of the
 * day before. The days themselves are plain `YYYY-MM-DD` strings, moved with
 * calendar arithmetic that needs no zone; the zone is an argument
 * (`useStudioZone()`), never the browser's.
 */
import { addDays, dayWindow, localDate, minutesIntoDay, startOfMonth, startOfWeek } from "./studio-time";

export type GridView = "day" | "week" | "month";

/** The calendar days a view draws, `last` inclusive. A month fills six week rows. */
export function gridDays(view: GridView, cursor: string): { first: string; last: string } {
  if (view === "day") return { first: cursor, last: cursor };
  if (view === "week") {
    const first = startOfWeek(cursor);
    return { first, last: addDays(first, 6) };
  }
  // Month: leading and trailing days fill six week rows, as the grid draws them.
  const first = startOfWeek(startOfMonth(cursor));
  return { first, last: addDays(first, 7 * 6 - 1) };
}

/** The instants to ask the schedule for: the studio's midnight of the first day up to the midnight after the last. */
export function gridWindow(timezone: string, view: GridView, cursor: string): { from: string; to: string } {
  const { first, last } = gridDays(view, cursor);
  const { startsAt, endsAt } = dayWindow(timezone, first, last);
  return { from: new Date(startsAt).toISOString(), to: new Date(endsAt).toISOString() };
}

/**
 * The instants for "from the start of today, for `days` days": the studio's
 * midnight today up to its midnight `days` calendar days on (a day is not
 * always 24 hours, so this is not `now + days * 24h`).
 */
export function upcomingWindow(
  timezone: string,
  days: number,
  now: number = Date.now(),
): { from: string; to: string } {
  const today = localDate(timezone, now);
  const { startsAt, endsAt } = dayWindow(timezone, today, addDays(today, days - 1));
  return { from: new Date(startsAt).toISOString(), to: new Date(endsAt).toISOString() };
}

/** Whether an event starting at `startsAt` falls on `day` at the studio. */
export function startsOnDay(timezone: string, startsAt: string, day: string): boolean {
  return localDate(timezone, startsAt) === day;
}

/** How far into the studio's day (minutes from its midnight) an instant is. */
export function minutesFromMidnight(timezone: string, instant: string | number | Date): number {
  return minutesIntoDay(timezone, instant);
}
