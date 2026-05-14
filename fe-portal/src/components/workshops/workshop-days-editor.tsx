"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import type { Capacity, WorkshopDay } from "@/types";

type Mode = "range" | "individual";

function defaultCapacity(): Capacity {
  return { waitlist: 0, onlineBooking: 12, buffer: 0 };
}

function newDay(date: string): WorkshopDay {
  return {
    id: `wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    date,
    startTime: "09:00",
    endTime: "12:00",
    capacity: defaultCapacity(),
    basePriceSgd: 100,
  };
}

function expandRange(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const out: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function WorkshopDaysEditor({
  mode,
  onModeChange,
  rangeStart,
  rangeEnd,
  onRangeChange,
  days,
  onChange,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  rangeStart: string;
  rangeEnd: string;
  onRangeChange: (start: string, end: string) => void;
  days: WorkshopDay[];
  onChange: (days: WorkshopDay[]) => void;
}) {
  function regenerateFromRange(start: string, end: string) {
    onRangeChange(start, end);
    const dates = expandRange(start, end);
    onChange(
      dates.map((d, i) => {
        const existing = days[i];
        return existing ? { ...existing, date: d } : newDay(d);
      })
    );
  }

  function addIndividual() {
    const last = days[days.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
    const next = new Date(last + "T00:00:00");
    next.setDate(next.getDate() + 7);
    onChange([...days, newDay(next.toISOString().slice(0, 10))]);
  }

  function updateDay(id: string, patch: Partial<WorkshopDay>) {
    onChange(days.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDay(id: string) {
    onChange(days.filter((d) => d.id !== id));
  }

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["range", "individual"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`rounded-full border px-3 py-1 text-xs ${
              mode === m
                ? "border-accent bg-accent/10 text-ink"
                : "border-border bg-card text-muted"
            }`}
          >
            {m === "range" ? "Date range" : "Individual dates"}
          </button>
        ))}
      </div>

      {mode === "range" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Start date</Label>
            <Input
              type="date"
              value={rangeStart}
              onChange={(e) => regenerateFromRange(e.target.value, rangeEnd)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End date</Label>
            <Input
              type="date"
              value={rangeEnd}
              onChange={(e) => regenerateFromRange(rangeStart, e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((d, idx) => (
          <div key={d.id} className="space-y-3 rounded-lg border border-border bg-paper p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                Day {idx + 1}
              </div>
              <button
                type="button"
                onClick={() => removeDay(d.id)}
                className="rounded p-1 text-muted hover:text-error"
                aria-label="Remove day"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={d.date}
                  disabled={mode === "range"}
                  onChange={(e) => updateDay(d.id, { date: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Start time</Label>
                <Input
                  type="time"
                  value={d.startTime}
                  onChange={(e) => updateDay(d.id, { startTime: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End time</Label>
                <Input
                  type="time"
                  value={d.endTime}
                  onChange={(e) => updateDay(d.id, { endTime: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Base price (SGD)</Label>
                <Input
                  type="number"
                  min={0}
                  value={d.basePriceSgd}
                  onChange={(e) =>
                    updateDay(d.id, { basePriceSgd: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </div>
            </div>
            <CapacityFields
              value={d.capacity}
              onChange={(cap) => updateDay(d.id, { capacity: cap })}
            />
          </div>
        ))}
      </div>

      {mode === "individual" && (
        <Button type="button" size="sm" variant="ghost" onClick={addIndividual}>
          <Plus className="h-3.5 w-3.5" /> Add date
        </Button>
      )}
      {days.length === 0 && mode === "range" && (
        <p className="text-xs text-muted">Set a start and end date to generate day rows.</p>
      )}
    </div>
  );
}
