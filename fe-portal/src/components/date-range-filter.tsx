"use client";

import { useState } from "react";
import { useStudioZone } from "@/components/brand/brand-provider";
import { dropDrafts, noDrafts, shownDay, typeDay } from "@/lib/date-range-draft";
import { presetRange, sameRange, type DateRange, type PresetKey } from "@/lib/date-range";
import { EARLIEST_DATE, LATEST_DATE } from "@/lib/formatters";

/**
 * Preset + custom date-range filter, shared by the admin and instructor payroll
 * pages. Range is held as YYYY-MM-DD strings (what <input type="date"> speaks);
 * `null` means "all time". Every preset ("Today", "This week") is read on the
 * studio's clock, not the browser's, and `rangeToParams()` (`lib/date-range.ts`)
 * turns the days into the studio's midnights the API expects.
 */

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const timezone = useStudioZone();
  // Derived, not stored — no preset/custom state to drift out of sync.
  const activeKey = PRESETS.find((p) => sameRange(presetRange(timezone, p.key), value))?.key;
  const isCustom = !activeKey;

  // The date inputs are disclosed, not permanent: showing two empty dd/mm/yyyy
  // fields under an active preset reads as unfilled required fields. Picking a
  // preset closes them again, so this can't drift out of sync with `value`.
  const [customOpen, setCustomOpen] = useState(isCustom);
  const showDates = isCustom || customOpen;

  // What is typed is shown as a draft and reaches the filter only once it is a
  // day it may filter by: a controlled input handed the old value back after
  // each key would wipe a year being typed (0002, 0020, 0202, 2025).
  const [drafts, setDrafts] = useState(() => noDrafts(value));
  function setEndpoint(which: "from" | "to", typed: string) {
    const step = typeDay(value, drafts, which, typed);
    setDrafts(step.drafts);
    if (step.commit) onChange(step.commit);
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
                setDrafts(dropDrafts(value));
                onChange(presetRange(timezone, p.key));
              }}
              className={`min-h-9 rounded-full px-3 py-1.5 font-medium transition sm:min-h-0 ${
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
          className={`min-h-9 rounded-full px-3 py-1.5 font-medium transition sm:min-h-0 ${
            isCustom ? "bg-accent text-white" : "bg-paper text-muted hover:text-ink"
          }`}
        >
          Custom
        </button>
      </div>
      {showDates && (
        // On a phone the two dates share the row equally; a date input's
        // intrinsic width would otherwise push the second one off the edge.
        <div className="flex items-center gap-2 pt-0.5">
          <input
            type="date"
            aria-label="From date"
            min={EARLIEST_DATE}
            max={LATEST_DATE}
            value={shownDay(value, drafts, "from")}
            onChange={(e) => setEndpoint("from", e.target.value)}
            onBlur={() => setDrafts(dropDrafts(value))}
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-paper px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-9 sm:flex-none"
          />
          <span className="shrink-0 text-xs text-muted">to</span>
          <input
            type="date"
            aria-label="To date"
            min={EARLIEST_DATE}
            max={LATEST_DATE}
            value={shownDay(value, drafts, "to")}
            onChange={(e) => setEndpoint("to", e.target.value)}
            onBlur={() => setDrafts(dropDrafts(value))}
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-paper px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-9 sm:flex-none"
          />
        </div>
      )}
    </div>
  );
}
