/**
 * The one rule for converting between a calendar day the admin picks in a
 * `<input type="date">` (`YYYY-MM-DD`) and the timestamps the API stores.
 *
 * A bare calendar day always means a day on the *studio's* clock: the studio's
 * midnight through the last instant of that studio day. The zone is an
 * argument, from `useStudioZone()`, and never the browser's: an admin
 * travelling abroad, or a Platform administrator acting as the studio, types
 * 19:00 and means 19:00 at the studio. Never slice a UTC ISO string to get a
 * day either: that shifts the date by one for anyone whose zone is not UTC (a
 * 7pm Singapore class reads as tomorrow, local midnight as yesterday).
 *
 * Built on `studio-time.ts`, which owns the daylight-saving rules.
 */
import { addDays, instantAt, localDate } from "./studio-time";

/** The studio's calendar day (`YYYY-MM-DD`) an instant falls on. Defaults to now. */
export function localDay(timezone: string, at: Date | string | number = Date.now()): string {
  // A bare `YYYY-MM-DD` is already a calendar day — hand it back untouched.
  // Parsing it would give UTC midnight (the spec says bare dates are UTC), which
  // reads as the PREVIOUS day anywhere west of UTC.
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  return localDate(timezone, at);
}

/** A wall-clock `HH:MM` on a calendar day at the studio, as an instant. */
export function atLocalTime(timezone: string, day: string, time: string): Date {
  return new Date(instantAt(timezone, day, time));
}

/**
 * The studio's midnight → the last instant of that studio day. Both ends
 * inclusive. A day is 23 or 25 hours long on a daylight-saving change, so the
 * end is found from the day's own last minute, never as start + 24 hours.
 */
export function localDayRange(timezone: string, day: string): { start: Date; end: Date } {
  const next = addDays(day, 1);
  // The instant before the next midnight, so a day whose last hour happens twice
  // (clocks falling back at midnight, as in Santiago or Cairo) runs to the end of
  // the second. The day after 9999-12-31 is year 10000, which has no four-digit
  // date: that one day is ended at its own last minute instead.
  const end = /^\d{4}-/.test(next)
    ? instantAt(timezone, next, "00:00") - 1
    : instantAt(timezone, day, "23:59") + 59_999;
  return { start: atLocalTime(timezone, day, "00:00"), end: new Date(end) };
}
