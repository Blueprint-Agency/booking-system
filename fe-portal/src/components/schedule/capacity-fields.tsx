"use client";
import { Label } from "@/components/ui";
import { capacityLine } from "@/lib/capacity";
import { waitlistFieldLabel } from "@/lib/class-waitlist";
import type { Capacity } from "@/types";

export function CapacityFields({
  value,
  onChange,
  waitlistsOn,
}: {
  value: Capacity;
  onChange: (next: Capacity) => void;
  /**
   * The studio's waitlist switch (spec-waitlist.md §8). Off, the Waitlist field
   * stays — the number is kept for when they are turned on — and says so.
   */
  waitlistsOn?: boolean;
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
      <div className="grid gap-3 min-[420px]:grid-cols-3">
        <Field
          label={waitlistFieldLabel(waitlistsOn)}
          value={value.waitlist}
          onChange={(v) => set("waitlist", v)}
        />
        <Field
          label="Online booking"
          value={value.onlineBooking}
          onChange={(v) => set("onlineBooking", v)}
        />
        <Field label="Buffer" value={value.buffer} onChange={(v) => set("buffer", v)} />
      </div>
      <div className="mt-3 border-t border-border pt-3 text-sm font-semibold tabular-nums text-ink">
        {capacityLine(value)}
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
        className="h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
      />
    </div>
  );
}
