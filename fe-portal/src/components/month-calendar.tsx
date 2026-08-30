"use client";

import type { ReactNode } from "react";
import {
  addDays,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/**
 * The month grid every calendar in the portal draws: a Monday-first 6×7 block of
 * day cells, each with the date pill, an optional corner badge and whatever the
 * caller wants inside. Payroll and leave both render through it, so a change to
 * the grid is a change to all of them.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The 42 days a month's grid covers, including the neighbouring months' edges. */
export function monthGridDays(monthStart: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 });
  return eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });
}

/** The chip a calendar entry is drawn as. Colours come from the caller. */
export const calendarChipClass =
  "flex items-center gap-1 truncate rounded-sm px-1.5 py-1 text-[11px] font-medium ring-1 ring-inset ring-current/10";

export interface MonthCalendarCell {
  /** Grey the cell out on top of the automatic out-of-month greying. */
  dim?: boolean;
  /** Top-right corner, next to the date. */
  badge?: ReactNode;
  /** The cell's contents below the date row. */
  body?: ReactNode;
}

export function MonthCalendar({
  monthStart,
  renderDay,
}: {
  monthStart: Date;
  renderDay: (
    day: Date,
    ctx: { inMonth: boolean; isToday: boolean },
  ) => MonthCalendarCell;
}) {
  const days = monthGridDays(monthStart);
  const today = startOfDay(new Date());

  return (
    // Seven columns can't shrink below legibility: on a phone the month scrolls
    // sideways at a fixed 640px rather than squeezing each day to ~50px, which
    // leaves no room for the date and its chips to sit side by side.
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-border bg-paper/40">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted sm:text-xs"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const inMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, today);
            const cell = renderDay(day, { inMonth, isToday });
            const dimmed = !inMonth || !!cell.dim;

            return (
              <div
                key={day.toISOString()}
                className={`min-h-[88px] border-b border-r border-border p-1.5 last:border-r-0 sm:min-h-[120px] sm:p-2 ${
                  dimmed ? "bg-paper/30" : ""
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                      isToday ? "bg-accent text-white" : dimmed ? "text-muted" : "text-ink"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {cell.badge}
                </div>
                {cell.body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
