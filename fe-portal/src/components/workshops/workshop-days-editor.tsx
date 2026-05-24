"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import { todayIso } from "@/lib/formatters";
import type { Capacity, WorkshopDay } from "@/types";

type Mode = "range" | "individual";

export interface RoomOption {
  id: string;
  name: string;
}

function defaultCapacity(): Capacity {
  return { waitlist: 0, onlineBooking: 12, buffer: 0 };
}

function newDay(date: string): WorkshopDay {
  return {
    id: `wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    date,
    startTime: "09:00",
    endTime: "12:00",
    roomId: "",
    capacity: defaultCapacity(),
  };
}

function expandRange(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  // Iterate by ISO date string directly so we never round-trip through
  // toISOString() in a non-UTC timezone (which would shift each date by ±1 day).
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d));
    next.setUTCDate(next.getUTCDate() + 1);
    cur = next.toISOString().slice(0, 10);
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
  rooms,
  locationChosen,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  rangeStart: string;
  rangeEnd: string;
  onRangeChange: (start: string, end: string) => void;
  days: WorkshopDay[];
  onChange: (days: WorkshopDay[]) => void;
  rooms: RoomOption[];
  locationChosen: boolean;
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
              min={todayIso()}
              value={rangeStart}
              onChange={(e) => {
                const start = e.target.value;
                // Keep end on/after start.
                const end = rangeEnd && rangeEnd < start ? start : rangeEnd;
                regenerateFromRange(start, end);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End date</Label>
            <Input
              type="date"
              min={rangeStart || todayIso()}
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
              {mode === "individual" && (
                <button
                  type="button"
                  onClick={() => removeDay(d.id)}
                  className="rounded p-1 text-muted hover:text-error"
                  aria-label="Remove day"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  min={todayIso()}
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
                  min={d.startTime || undefined}
                  value={d.endTime}
                  aria-invalid={!!d.endTime && !!d.startTime && d.endTime <= d.startTime}
                  onChange={(e) => updateDay(d.id, { endTime: e.target.value })}
                />
                {d.endTime && d.startTime && d.endTime <= d.startTime && (
                  <p className="text-xs text-error">End must be after start.</p>
                )}
              </div>
              <div className="space-y-1 md:col-span-3">
                <Label className="text-xs">
                  Room <span className="text-error">*</span>
                </Label>
                <select
                  value={d.roomId}
                  required
                  disabled={!locationChosen}
                  onChange={(e) => updateDay(d.id, { roomId: e.target.value })}
                  aria-invalid={locationChosen && !d.roomId}
                  className={`flex h-10 w-full rounded-lg border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                    locationChosen && !d.roomId ? "border-error" : "border-border"
                  }`}
                >
                  <option value="">
                    {locationChosen ? "Select room…" : "Pick a location first"}
                  </option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {locationChosen && rooms.length === 0 && (
                  <p className="text-xs text-error">
                    No rooms at this location yet — add one under Building Blocks → Rooms.
                  </p>
                )}
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
