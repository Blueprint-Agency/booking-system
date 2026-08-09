"use client";

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
import { formatSgd } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import type { ApiPayrollRow } from "@/lib/payroll";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function monthGridDays(monthStart: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 });
  return eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });
}

export function PayrollCalendar({
  monthStart,
  rows,
}: {
  monthStart: Date;
  rows: ApiPayrollRow[];
}) {
  const days = monthGridDays(monthStart);
  const today = startOfDay(new Date());

  // Bucket once rather than re-filtering the array in all 42 cells.
  const byDay = new Map<string, ApiPayrollRow[]>();
  for (const r of rows) {
    const k = localDay(r.starts_at);
    const bucket = byDay.get(k);
    if (bucket) bucket.push(r);
    else byDay.set(k, [r]);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
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
          const entries = byDay.get(localDay(day)) ?? [];
          const inMonth = isSameMonth(day, monthStart);
          // Payroll only ever covers finished sessions, so a future cell isn't
          // empty-because-nothing-happened — it hasn't happened yet.
          const future = day > today;
          const isToday = isSameDay(day, today);
          const total = entries.reduce((s, e) => s + (e.instructor_pay_sgd ?? 0), 0);

          return (
            <div
              key={day.toISOString()}
              className={`min-h-[88px] border-b border-r border-border p-1.5 last:border-r-0 sm:min-h-[120px] sm:p-2 ${
                !inMonth || future ? "bg-paper/30" : ""
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    isToday
                      ? "bg-accent text-white"
                      : inMonth && !future
                        ? "text-ink"
                        : "text-muted"
                  }`}
                >
                  {format(day, "d")}
                </span>
                {total > 0 && (
                  <span className="truncate rounded-full bg-paper px-1.5 text-[10px] font-semibold tabular-nums text-muted">
                    {formatSgd(total)}
                  </span>
                )}
              </div>

              {entries.length > 0 && (
                <ul className="space-y-1">
                  {entries.slice(0, 3).map((e) => (
                    <li
                      key={`${e.kind}:${e.id}:${e.instructor_id}`}
                      title={`${e.instructor_name} — ${e.label}`}
                      className={`flex items-center gap-1 truncate rounded-sm border-l-[3px] px-1.5 py-1 text-[11px] font-medium ring-1 ring-inset ring-current/10 ${
                        e.instructor_pay_sgd == null
                          ? "border-warning bg-warning/15 text-warning"
                          : "border-accent bg-accent/10 text-accent"
                      }`}
                    >
                      <span className="truncate">{e.instructor_name}</span>
                      <span className="ml-auto shrink-0 tabular-nums">
                        {e.instructor_pay_sgd == null
                          ? "—"
                          : formatSgd(e.instructor_pay_sgd)}
                      </span>
                    </li>
                  ))}
                  {entries.length > 3 && (
                    <li className="px-1 text-[10px] font-medium text-muted">
                      +{entries.length - 3} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
