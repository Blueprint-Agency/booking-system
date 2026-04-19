import {
  addDays,
  addWeeks,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Session } from "@/types";

/** Anchor: weeks start Monday for the studio. */
const WEEK_OPTS = { weekStartsOn: 1 as const };

export type CalendarView = "week" | "month";

export function weekRange(anchor: Date): { start: Date; end: Date; days: Date[] } {
  const start = startOfWeek(anchor, WEEK_OPTS);
  const end = endOfWeek(anchor, WEEK_OPTS);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end, days };
}

export function monthRange(anchor: Date): { start: Date; end: Date; days: Date[] } {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, WEEK_OPTS);
  const gridEnd = endOfWeek(monthEnd, WEEK_OPTS);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  return { start: gridStart, end: gridEnd, days };
}

export function stepAnchor(anchor: Date, view: CalendarView, dir: 1 | -1): Date {
  return view === "week" ? addWeeks(anchor, dir) : addMonths(anchor, dir);
}

export function formatAnchorLabel(anchor: Date, view: CalendarView): string {
  if (view === "week") {
    const { start, end } = weekRange(anchor);
    const sameMonth = start.getMonth() === end.getMonth();
    return sameMonth
      ? `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`
      : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return format(anchor, "MMMM yyyy");
}

export function isoDay(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function sessionsOn(sessions: Session[], date: Date): Session[] {
  const iso = isoDay(date);
  return sessions
    .filter((s) => s.date === iso)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function sessionsInRange(sessions: Session[], start: Date, end: Date): Session[] {
  return sessions.filter((s) => {
    const d = parseISO(s.date);
    return d >= start && d <= end;
  });
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}

/** Generate forward instances of a recurring class template. */
export function generateInstancesFromTemplate(args: {
  tenantId: string;
  locationId: string;
  name: string;
  category: string;
  level: Session["level"];
  instructorId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
  duration: number;
  capacity: number;
  weeks?: number;
  startDate?: Date;
}): Omit<Session, "id">[] {
  const weeks = args.weeks ?? 12;
  const startDate = args.startDate ?? new Date();
  const out: Omit<Session, "id">[] = [];
  let cursor = startOfWeek(startDate, WEEK_OPTS);
  const offset = (args.dayOfWeek + 6) % 7; // Mon=0 ... Sun=6
  cursor = addDays(cursor, offset);
  if (cursor < startDate) cursor = addDays(cursor, 7);
  for (let i = 0; i < weeks; i++) {
    const date = addDays(cursor, i * 7);
    out.push({
      tenantId: args.tenantId,
      locationId: args.locationId,
      templateId: null,
      name: args.name,
      category: args.category,
      level: args.level,
      type: "regular",
      instructorId: args.instructorId,
      capacity: args.capacity,
      bookedCount: 0,
      waitlistCount: 0,
      date: isoDay(date),
      time: args.time,
      duration: args.duration,
      price: 0,
      status: "scheduled",
      recurrence: `weekly:${args.dayOfWeek}:${args.time}`,
    });
  }
  return out;
}
