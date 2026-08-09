/**
 * The one rule for converting between a calendar day the admin picks in a
 * `<input type="date">` (`YYYY-MM-DD`) and the timestamps the API stores.
 *
 * A bare calendar day always means the *local* day: local midnight through the
 * last instant of that local day. Never slice a UTC ISO string to get a day —
 * that shifts the date by one for anyone not sitting on UTC (SGT is +8, so a
 * 7pm class reads as tomorrow and local midnight reads as yesterday).
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day (`YYYY-MM-DD`) an instant falls on. Defaults to now. */
export function localDay(at: Date | string = new Date()): string {
  // A bare `YYYY-MM-DD` is already a calendar day — hand it back untouched.
  // Parsing it would give UTC midnight (the spec says bare dates are UTC), which
  // reads as the PREVIOUS day anywhere west of UTC.
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const d = typeof at === "string" ? new Date(at) : at;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local wall-clock `HH:MM` on a local calendar day, as an instant. */
export function atLocalTime(day: string, time: string): Date {
  return new Date(`${day}T${time}:00`);
}

/** Local midnight → the last instant of that local day. Both ends inclusive. */
export function localDayRange(day: string): { start: Date; end: Date } {
  return { start: atLocalTime(day, "00:00"), end: new Date(`${day}T23:59:59.999`) };
}
