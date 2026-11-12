/**
 * The timetable's List view: one month at a time, in its weeks, each week a
 * section that opens and closes, and inside it the days that have something on.
 *
 * Like the grids, all of it is on the studio's clock (`schedule-grid.ts`): an
 * entry falls on the studio's day, and a week runs Monday to Sunday, cut to the
 * month at either end so a week is never listed under two months.
 */
import { gridDays } from "./schedule-grid";
import { addDays, localDate, startOfWeek } from "./studio-time";

export interface ListDay<E> {
  /** `YYYY-MM-DD` on the studio's calendar. */
  day: string;
  entries: E[];
}

export interface ListWeek<E> {
  /** The week's Monday, which may be in the month before: names the section. */
  key: string;
  /** The week's first and last days inside the month, inclusive. */
  first: string;
  last: string;
  /** Only the days with something on, in order. */
  days: ListDay<E>[];
  count: number;
}

/** Every week of `cursor`'s month, with the entries that start in each, soonest first. */
export function listWeeks<E extends { startsAt: string }>(
  entries: readonly E[],
  timezone: string,
  cursor: string,
): ListWeek<E>[] {
  const month = gridDays("list", cursor);
  const byDay = new Map<string, E[]>();
  for (const e of [...entries].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const day = localDate(timezone, e.startsAt);
    if (day < month.first || day > month.last) continue;
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }

  const weeks: ListWeek<E>[] = [];
  for (let monday = startOfWeek(month.first); monday <= month.last; monday = addDays(monday, 7)) {
    const first = monday < month.first ? month.first : monday;
    const sunday = addDays(monday, 6);
    const last = sunday > month.last ? month.last : sunday;
    const days: ListDay<E>[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const on = byDay.get(d);
      if (on) days.push({ day: d, entries: on });
    }
    weeks.push({ key: monday, first, last, days, count: days.reduce((n, d) => n + d.entries.length, 0) });
  }
  return weeks;
}

/**
 * The weeks open when a month is first listed. In the month holding today the
 * weeks already over start closed, so the list opens on what is coming; any
 * other month opens whole.
 */
export function weeksOpenAtFirst(weeks: readonly ListWeek<unknown>[], today: string): Set<string> {
  const holdsToday = weeks.some((w) => w.first <= today && today <= w.last);
  return new Set(weeks.filter((w) => !holdsToday || w.last >= today).map((w) => w.key));
}
