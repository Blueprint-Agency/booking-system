"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addMonths, format as formatDateFns, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { MonthCalendar, calendarChipClass, monthGridDays } from "@/components/month-calendar";
import { useWorkspace } from "@/lib/workspace-context";
import { localDay } from "@/lib/local-day";
import { LEAVE_HALF_DAY_SHORT, LEAVE_TYPE_LABEL, type LeaveType } from "@/lib/leave";

/**
 * Who is away, for everybody on staff — the same widget on the admin leave page
 * and the instructor one.
 *
 * The backend decides what this can show: `detail` arrives null for a
 * colleague's leave when an instructor is looking, so the type, the reason, the
 * decision and the Supporting Document are simply not in the response. This component
 * renders what it was given and hides nothing of its own.
 */

interface ApiLeaveCalendarEntry {
  id: string;
  instructor: { id: string; name: string };
  start_date: string;
  end_date: string;
  half_day: "none" | "morning" | "afternoon";
  status: "pending" | "approved";
  detail: {
    type: LeaveType;
    days: number;
    reason: string;
    decision_reason: string | null;
    decided_by: string | null;
    has_supporting_document: boolean;
  } | null;
}

/** Approved is a settled absence; pending is a signal, not a fact — but it still
 *  blocks scheduling, so it is drawn, just visibly unsettled. */
const CHIP_TONE = {
  approved: "border-l-[3px] border-sage bg-sage/10 text-sage",
  pending: "border border-dashed border-warning bg-warning/10 text-warning",
} as const;

function tooltip(e: ApiLeaveCalendarEntry): string {
  const head =
    `${e.instructor.name} — ${e.status === "pending" ? "pending" : "on leave"}` +
    (e.half_day === "morning" ? " (morning)" : e.half_day === "afternoon" ? " (afternoon)" : "");
  if (!e.detail) return head;
  const bits = [
    `${LEAVE_TYPE_LABEL[e.detail.type]} leave`,
    `${e.detail.days} day(s)`,
    e.detail.reason,
  ];
  if (e.detail.decision_reason) bits.push(`Decision: ${e.detail.decision_reason}`);
  if (e.detail.decided_by) bits.push(`Decided by ${e.detail.decided_by}`);
  return `${head}\n${bits.join("\n")}`;
}

export function LeaveCalendar() {
  const { api } = useWorkspace();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [entries, setEntries] = useState<ApiLeaveCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The whole grid, not just the month — an absence on a trailing day of the
  // previous month still has to show in the cell it is drawn in.
  const range = useMemo(() => {
    const days = monthGridDays(cursor);
    return { from: localDay(days[0]), to: localDay(days[days.length - 1]) };
  }, [cursor]);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ leave: ApiLeaveCalendarEntry[] }>(
        "/portal/leave-calendar",
        range,
      );
      setEntries(res.leave ?? []);
    } catch {
      setError("Couldn't load the leave calendar.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [api, range]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold text-ink">Who is away</h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous month"
          onClick={() => setCursor((c) => addMonths(c, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[9rem] text-center text-sm font-semibold text-ink">
          {formatDateFns(cursor, "MMMM yyyy")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next month"
          onClick={() => setCursor((c) => addMonths(c, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="mb-2 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {error}
        </div>
      )}

      <MonthCalendar
        monthStart={cursor}
        renderDay={(day) => {
          // Plain `YYYY-MM-DD` strings compare correctly as strings, so no date
          // is parsed and nothing can shift a timezone.
          const key = localDay(day);
          const onLeave = entries.filter((e) => e.start_date <= key && key <= e.end_date);

          return {
            body: onLeave.length > 0 && (
              <ul className="space-y-1">
                {onLeave.slice(0, 3).map((e) => (
                  <li
                    key={e.id}
                    title={tooltip(e)}
                    className={`${calendarChipClass} ${CHIP_TONE[e.status]}`}
                  >
                    <span className="truncate">{e.instructor.name}</span>
                    {/* The type is restricted; which half is not — a colleague
                        may see "(AM)" without seeing what kind of leave it is. */}
                    {(e.detail || e.half_day !== "none") && (
                      <span className="ml-auto shrink-0 text-[10px] opacity-80">
                        {e.detail ? LEAVE_TYPE_LABEL[e.detail.type] : ""}
                        {LEAVE_HALF_DAY_SHORT[e.half_day]}
                      </span>
                    )}
                  </li>
                ))}
                {onLeave.length > 3 && (
                  <li className="px-1 text-[10px] font-medium text-muted">
                    +{onLeave.length - 3} more
                  </li>
                )}
              </ul>
            ),
          };
        }}
      />

      <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sage/40 ring-1 ring-inset ring-sage" />
          Approved
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-warning bg-warning/20" />
          Pending a decision — still blocks scheduling
        </span>
      </p>
    </section>
  );
}
