"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Select, Button, EmptyState } from "@/components/ui";
import { expandSchedule, type ScheduleOccurrence } from "@/lib/schedule";
import { OccurrenceCard } from "./occurrence-card";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateLabel(d: Date): string {
  return `${d.getDate()} ${d.toLocaleString(undefined, { month: "short" })}`;
}

export interface ScheduleCalendarProps {
  bulkSlot?: (
    args: {
      selectedDates: string[];
      clearSelection: () => void;
      weekStart: string;
    },
  ) => React.ReactNode;
  selectionEnabled?: boolean;
}

export function ScheduleCalendar({ bulkSlot, selectionEnabled }: ScheduleCalendarProps = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const tenantId = useCurrentTenantId();
  const state = useAdminState((s) => s);
  const instructors = useWithTenant(useAdminState((s) => s.instructors));
  const locations = useWithTenant(useAdminState((s) => s.locations));

  const locParam = params.get("location") ?? "";
  const instParam = params.get("instructor") ?? "";
  const levelParam = params.get("level") ?? "";

  const today = useMemo(() => new Date(), []);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today));
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekStart]);

  const occurrences = useMemo(() => {
    const list = expandSchedule(state, {
      tenantId,
      fromIso: fmtDate(weekStart),
      days: 14,
    });
    return list.filter((o) => {
      if (locParam && o.locationId !== locParam) return false;
      if (instParam && o.instructorId !== instParam) return false;
      if (levelParam && o.level !== levelParam) return false;
      return true;
    });
  }, [state, tenantId, weekStart, locParam, instParam, levelParam]);

  const byDate = useMemo(() => {
    const m = new Map<string, ScheduleOccurrence[]>();
    for (const o of occurrences) {
      const arr = m.get(o.date) ?? [];
      arr.push(o);
      m.set(o.date, arr);
    }
    return m;
  }, [occurrences]);

  const updateParam = useCallback(
    (k: string, v: string) => {
      const sp = new URLSearchParams(params.toString());
      if (v) sp.set(k, v);
      else sp.delete(k);
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const toggleDateSelect = (date: string) => {
    if (!selectionEnabled) return;
    setSelectedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  };

  const empty = occurrences.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() - 7);
              setWeekStart(d);
            }}
            className="rounded p-1.5 text-muted hover:text-ink"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded px-2 py-1 text-xs font-medium text-ink hover:bg-paper"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + 7);
              setWeekStart(d);
            }}
            className="rounded p-1.5 text-muted hover:text-ink"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="text-sm text-muted">
          <CalendarDays className="mr-1 inline h-4 w-4" />
          {dateLabel(days[0])} – {dateLabel(days[13])}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            Location
            <Select
              value={locParam}
              onChange={(e) => updateParam("location", e.target.value)}
              className="h-9 w-44"
            >
              <option value="">All</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            Instructor
            <Select
              value={instParam}
              onChange={(e) => updateParam("instructor", e.target.value)}
              className="h-9 w-44"
            >
              <option value="">All</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            Level
            <Select
              value={levelParam}
              onChange={(e) => updateParam("level", e.target.value)}
              className="h-9 w-32"
            >
              <option value="">All</option>
              <option value="all">All levels</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Select>
          </label>
          {(locParam || instParam || levelParam) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                router.replace("?", { scroll: false });
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {bulkSlot && selectedDates.length > 0
        ? bulkSlot({
            selectedDates,
            clearSelection: () => setSelectedDates([]),
            weekStart: fmtDate(weekStart),
          })
        : null}

      {empty ? (
        <EmptyState
          title="Nothing on the schedule"
          description="No class occurrences match these filters in the next 14 days."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((d) => {
            const dateStr = fmtDate(d);
            const items = byDate.get(dateStr) ?? [];
            const isToday = fmtDate(new Date()) === dateStr;
            const isSelected = selectedDates.includes(dateStr);
            return (
              <div
                key={dateStr}
                className={
                  "rounded-lg border " +
                  (isSelected ? "border-accent bg-accent/5 " : "border-border ") +
                  (isToday ? "ring-1 ring-accent/40 " : "") +
                  "bg-paper/30 p-2"
                }
              >
                <button
                  type="button"
                  onClick={() => toggleDateSelect(dateStr)}
                  className="mb-2 flex w-full items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-paper"
                  disabled={!selectionEnabled}
                >
                  <span className={"font-medium " + (isToday ? "text-accent" : "text-ink")}>
                    {DAY_LABELS[d.getDay()]} {d.getDate()}
                  </span>
                  <span className="text-muted">{items.length}</span>
                </button>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="rounded border border-dashed border-border/50 p-3 text-center text-xs text-muted">
                      No classes
                    </div>
                  ) : (
                    items.map((occ) => <OccurrenceCard key={occ.id} occurrence={occ} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
