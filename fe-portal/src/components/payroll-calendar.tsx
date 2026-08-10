"use client";

import { startOfDay } from "date-fns";
import { formatSgd } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import type { ApiPayrollRow } from "@/lib/payroll";
import { MonthCalendar, calendarChipClass } from "@/components/month-calendar";

export function PayrollCalendar({
  monthStart,
  rows,
}: {
  monthStart: Date;
  rows: ApiPayrollRow[];
}) {
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
    <MonthCalendar
      monthStart={monthStart}
      renderDay={(day) => {
        const entries = byDay.get(localDay(day)) ?? [];
        const total = entries.reduce((s, e) => s + (e.instructor_pay_sgd ?? 0), 0);

        return {
          // Payroll only ever covers finished sessions, so a future cell isn't
          // empty-because-nothing-happened — it hasn't happened yet.
          dim: day > today,
          badge: total > 0 && (
            <span className="truncate rounded-full bg-paper px-1.5 text-[10px] font-semibold tabular-nums text-muted">
              {formatSgd(total)}
            </span>
          ),
          body: entries.length > 0 && (
            <ul className="space-y-1">
              {entries.slice(0, 3).map((e) => (
                <li
                  key={`${e.kind}:${e.id}:${e.instructor_id}`}
                  title={`${e.instructor_name} — ${e.label}`}
                  className={`${calendarChipClass} border-l-[3px] ${
                    e.instructor_pay_sgd == null
                      ? "border-warning bg-warning/15 text-warning"
                      : "border-accent bg-accent/10 text-accent"
                  }`}
                >
                  <span className="truncate">{e.instructor_name}</span>
                  <span className="ml-auto shrink-0 tabular-nums">
                    {e.instructor_pay_sgd == null ? "—" : formatSgd(e.instructor_pay_sgd)}
                  </span>
                </li>
              ))}
              {entries.length > 3 && (
                <li className="px-1 text-[10px] font-medium text-muted">
                  +{entries.length - 3} more
                </li>
              )}
            </ul>
          ),
        };
      }}
    />
  );
}
