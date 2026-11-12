/**
 * Where a timetable is open: the day it is on and the view (day, week, month,
 * or the month as a list) it draws that day in.
 *
 * Staff set a week up a class at a time, leaving the timetable for each class's
 * form or detail and coming back. So the position rides in the timetable's
 * address (`?date=2026-11-09&view=week`), which brings back the browser's Back
 * and a reload, and is kept for the tab in session storage, which brings back
 * every other way in: a save that sends the form back to the bare timetable,
 * "Back to Schedule", the sidebar. "Today" is how to leave it.
 */
import type { ScheduleView } from "./schedule-grid";

export interface SchedulePosition {
  /** A plain `YYYY-MM-DD` on the studio's calendar. */
  date: string;
  view: ScheduleView;
}

const VIEWS: readonly ScheduleView[] = ["day", "week", "month", "list"];

/** A real calendar day as `YYYY-MM-DD`: `2026-02-30` and `2026-13-01` are not. */
export function isPlainDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function isView(value: unknown): value is ScheduleView {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}

/**
 * The parts of a position an address names. An address is user input, so a
 * part that is not a real day or view reads as absent rather than as an error.
 */
export function positionFromSearch(search: string): Partial<SchedulePosition> {
  const params = new URLSearchParams(search);
  const date = params.get("date");
  const view = params.get("view");
  return {
    ...(date && isPlainDay(date) ? { date } : {}),
    ...(isView(view) ? { view } : {}),
  };
}

/** The search string an address carries for a position. */
export function positionSearch(pos: SchedulePosition): string {
  return `?date=${pos.date}&view=${pos.view}`;
}

/** A position kept in session storage, or null when there is none or it is unreadable. */
export function parseStoredPosition(raw: string | null): SchedulePosition | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { date, view } = v as Record<string, unknown>;
    if (typeof date !== "string" || !isPlainDay(date) || !isView(view)) return null;
    return { date, view };
  } catch {
    return null;
  }
}

/**
 * Where a timetable opens. What the address names wins, part by part; an
 * address naming neither part opens where the tab last left the timetable;
 * with neither, today, in week view (day view on a phone, where seven columns
 * don't fit).
 */
export function openingPosition(args: {
  fromAddress: Partial<SchedulePosition>;
  stored: SchedulePosition | null;
  today: string;
  phone: boolean;
}): SchedulePosition {
  const { fromAddress, stored, today, phone } = args;
  const fallback: SchedulePosition = { date: today, view: phone ? "day" : "week" };
  if (fromAddress.date || fromAddress.view) {
    return { date: fromAddress.date ?? fallback.date, view: fromAddress.view ?? fallback.view };
  }
  return stored ?? fallback;
}
