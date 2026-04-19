"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { Button, Select } from "@/components/ui";
import { setAvailabilityTemplate, emptyWeekly } from "@/lib/mutations/availability";
import { cn } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

export interface AvailabilityTemplateGridProps {
  instructorId?: string; // when provided, lock to that instructor
  selectorEnabled?: boolean;
}

export function AvailabilityTemplateGrid({
  instructorId,
  selectorEnabled = true,
}: AvailabilityTemplateGridProps) {
  const instructors = useAdminState((s) => s.instructors);
  const templates = useAdminState((s) => s.availabilityTemplates);
  const [selectedId, setSelectedId] = useState<string>(
    instructorId ?? instructors[0]?.id ?? "",
  );
  const tmpl = useMemo(
    () => templates.find((t) => t.instructorId === selectedId),
    [templates, selectedId],
  );
  const [grid, setGrid] = useState<boolean[][]>(() => tmpl?.weekly ?? emptyWeekly());
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<null | { value: boolean }>(null);

  useEffect(() => {
    setGrid(tmpl?.weekly ?? emptyWeekly());
    setDirty(false);
  }, [tmpl, selectedId]);

  const toggle = (day: number, slot: number, value: boolean) => {
    setGrid((prev) => {
      if (prev[day][slot] === value) return prev;
      const next = prev.map((row) => [...row]);
      next[day][slot] = value;
      return next;
    });
    setDirty(true);
  };

  const save = () => {
    if (!selectedId) return;
    try {
      setAvailabilityTemplate(selectedId, grid);
      toast.success("Availability saved");
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {selectorEnabled && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Instructor
            <Select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="h-9 w-56"
            >
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <div className="text-xs text-muted">
          Click or click-drag cells to mark availability. Half-hour slots, Sun → Sat.
        </div>
        <div className="ml-auto">
          <Button type="button" onClick={save} disabled={!dirty}>
            Save
          </Button>
        </div>
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table
          className="table-fixed text-[10px] tabular-nums select-none"
          onMouseLeave={() => setDrag(null)}
          onMouseUp={() => setDrag(null)}
        >
          <colgroup>
            <col className="w-16" />
            {SLOTS.map((_, idx) => (
              <col key={idx} className="w-4" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-1 text-left text-muted" />
              {Array.from({ length: 24 }).map((_, hour) => (
                <th
                  key={hour}
                  colSpan={2}
                  className={cn(
                    "border-b border-border py-1 text-left text-muted font-normal",
                    hour % 2 === 0 ? "bg-paper/40" : "",
                  )}
                >
                  <span className="ml-0.5">{`${String(hour).padStart(2, "0")}:00`}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((label, dayIdx) => (
              <tr key={label}>
                <th className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-1 text-left text-ink font-medium">
                  {label}
                </th>
                {SLOTS.map((_, slotIdx) => {
                  const on = grid[dayIdx][slotIdx];
                  return (
                    <td
                      key={slotIdx}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const next = !on;
                        toggle(dayIdx, slotIdx, next);
                        setDrag({ value: next });
                      }}
                      onMouseEnter={() => {
                        if (drag) toggle(dayIdx, slotIdx, drag.value);
                      }}
                      className={cn(
                        "h-6 cursor-pointer border-b border-border transition-colors",
                        on ? "bg-accent" : "bg-card hover:bg-paper",
                        slotIdx % 4 === 0 ? "border-l border-l-border/60" : "",
                      )}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
