/**
 * The class schedule's days, on the studio's clock: where its window opens and
 * closes, which day a class falls under, and what a day's header says. Pure and
 * given the zone, so a Sydney studio's midnight (and its 23- and 25-hour
 * daylight-saving days) can be tested apart from the page that draws them.
 */
import { addDays, datePlus, formatPlainWeekday, instantAt, localDate } from "./studio-time.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The window the schedule is read for: from the studio's midnight today to its
 * midnight `days` on, as the instants the classes read takes. Not the device's
 * midnight, which can be another day at the studio.
 */
export function feedWindow(timezone: string, now: number, days: number): { from: string; to: string } {
  return {
    from: new Date(instantAt(timezone, localDate(timezone, now), "00:00")).toISOString(),
    to: new Date(instantAt(timezone, datePlus(timezone, days, now), "00:00")).toISOString(),
  };
}

/**
 * The classes still to come, soonest first, grouped under the studio's day each
 * starts on. A class at 23:30 and one at 00:30 either side of the studio's
 * midnight are two days, whatever zone the device is in.
 */
export function feedDays<T extends { starts_at: string }>(
  classes: readonly T[],
  nowMs: number,
  timezone: string,
): { date: string; items: T[] }[] {
  const upcoming = classes
    .filter((c) => new Date(c.starts_at).getTime() >= nowMs)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const byDay = new Map<string, T[]>();
  for (const c of upcoming) {
    const day = localDate(timezone, c.starts_at);
    const items = byDay.get(day);
    if (items) items.push(c);
    else byDay.set(day, [c]);
  }
  return Array.from(byDay, ([date, items]) => ({ date, items }));
}

/** "Today · Oct 4", "Tomorrow · Oct 5", then "Tue · Oct 6": a day header, today being the studio's. */
export function dayHeaderLabel(date: string, timezone: string, now: number): string {
  const today = localDate(timezone, now);
  const monthDay = `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
  if (date === today) return `Today · ${monthDay}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${monthDay}`;
  return `${formatPlainWeekday(date)} · ${monthDay}`;
}
