"use client";

import { useState } from "react";
import { localDay, localDayRange } from "@/lib/local-day";

/**
 * Preset + custom date-range filter, shared by the admin and instructor payroll
 * pages. Range is held as YYYY-MM-DD strings (what <input type="date"> speaks);
 * `null` means "all time". Call rangeToParams() to get the ISO from/to the API
 * expects.
 */

export type DateRange = { from: string; to: string } | null;

export type PresetKey = "today" | "7d" | "14d" | "30d" | "month" | "year" | "all";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

export function presetRange(key: PresetKey): DateRange {
  const now = new Date();
  const today = localDay(now);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "7d":
    case "14d":
    case "30d": {
      const n = key === "7d" ? 7 : key === "14d" ? 14 : 30;
      const start = new Date(now);
      start.setDate(now.getDate() - (n - 1));
      return { from: localDay(start), to: today };
    }
    case "month":
      // Payroll is past-only, so ending "today" rather than end-of-month is
      // equivalent and reads more honestly.
      return { from: localDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "year":
      return { from: localDay(new Date(now.getFullYear(), 0, 1)), to: today };
    case "all":
      return null;
  }
}

/** Local-midnight → ISO instants for the API's `from`/`to` query params. */
export function rangeToParams(r: DateRange): {
  from: string | undefined;
  to: string | undefined;
} {
  if (!r) return { from: undefined, to: undefined };
  return {
    from: localDayRange(r.from).start.toISOString(),
    to: localDayRange(r.to).end.toISOString(),
  };
}

function sameRange(a: DateRange, b: DateRange): boolean {
  if (a === null || b === null) return a === b;
  return a.from === b.from && a.to === b.to;
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  // Derived, not stored — no preset/custom state to drift out of sync.
  const activeKey = PRESETS.find((p) => sameRange(presetRange(p.key), value))?.key;
  const isCustom = !activeKey;

  // The date inputs are disclosed, not permanent: showing two empty dd/mm/yyyy
  // fields under an active preset reads as unfilled required fields. Picking a
  // preset closes them again, so this can't drift out of sync with `value`.
  const [customOpen, setCustomOpen] = useState(isCustom);
  const showDates = isCustom || customOpen;

  // Editing either endpoint keeps the other; falling back to the typed date
  // covers editing while "All time" is selected and there's no range yet.
  function setEndpoint(which: "from" | "to", v: string) {
    if (!v) return;
    const base = value ?? { from: v, to: v };
    const next = { ...base, [which]: v };
    // Keep the range ordered if the user picks a start after the end.
    onChange(next.from > next.to ? { from: next.to, to: next.from } : next);
  }

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-muted">Period</span>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {PRESETS.map((p) => {
          const active = activeKey === p.key;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustomOpen(false);
                onChange(presetRange(p.key));
              }}
              className={`rounded-full px-3 py-1.5 font-medium transition ${
                active
                  ? "bg-accent text-white"
                  : "bg-paper text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={isCustom}
          aria-expanded={showDates}
          onClick={() => setCustomOpen(true)}
          className={`rounded-full px-3 py-1.5 font-medium transition ${
            isCustom ? "bg-accent text-white" : "bg-paper text-muted hover:text-ink"
          }`}
        >
          Custom
        </button>
      </div>
      {showDates && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <input
            type="date"
            aria-label="From date"
            value={value?.from ?? ""}
            onChange={(e) => setEndpoint("from", e.target.value)}
            className="h-9 rounded-lg border border-border bg-paper px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            aria-label="To date"
            value={value?.to ?? ""}
            onChange={(e) => setEndpoint("to", e.target.value)}
            className="h-9 rounded-lg border border-border bg-paper px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      )}
    </div>
  );
}
