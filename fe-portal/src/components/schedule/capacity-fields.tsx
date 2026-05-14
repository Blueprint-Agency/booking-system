"use client";
import { Label } from "@/components/ui";
import { maxCapacity } from "@/lib/capacity";
import type { Capacity } from "@/types";

export function CapacityFields({
  value,
  onChange,
}: {
  value: Capacity;
  onChange: (next: Capacity) => void;
}) {
  function set(key: keyof Capacity, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    onChange({ ...value, [key]: n });
  }
  return (
    <div className="rounded-lg border border-border bg-paper p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        Capacity
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Waitlist" value={value.waitlist} onChange={(v) => set("waitlist", v)} />
        <Field
          label="Online booking"
          value={value.onlineBooking}
          onChange={(v) => set("onlineBooking", v)}
        />
        <Field label="Buffer" value={value.buffer} onChange={(v) => set("buffer", v)} />
      </div>
      <div className="mt-3 border-t border-border pt-3 text-sm">
        <span className="text-muted">Max capacity: </span>
        <span className="font-semibold text-ink">{maxCapacity(value)}</span>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
      />
    </div>
  );
}
