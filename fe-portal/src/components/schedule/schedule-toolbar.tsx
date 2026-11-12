"use client";
// The controls around the timetable grid, shared by the Admin's Schedule and
// an Instructor's My schedule so the two pages are one page: the "+ …" buttons
// that arm the grid, the arrows and Today, the Filters button and its pills,
// and the band that says the grid is waiting for a slot.

import { ChevronLeft, ChevronRight, Filter as FilterIcon, MousePointerClick, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatPlainDay } from "@/lib/formatters";
import type { ScheduleView } from "@/lib/schedule-grid";
import { addDays, addMonths } from "@/lib/studio-time";

/** The view toggle's choices, the same on every timetable: the three grids, then the List. */
export const SCHEDULE_VIEW_OPTIONS: readonly { v: ScheduleView; label: string }[] = [
  { v: "day", label: "Day" },
  { v: "week", label: "Week" },
  { v: "month", label: "Month" },
  { v: "list", label: "List" },
];

/** The day, week or month the timetable shows, as its toolbar names it. */
export function gridHeading(view: ScheduleView, cursor: string, first: string, last: string): string {
  if (view === "day") return formatPlainDay(cursor, "EEEE, d MMM yyyy");
  if (view === "week") return `${formatPlainDay(first, "d MMM")} – ${formatPlainDay(last, "d MMM yyyy")}`;
  return formatPlainDay(cursor, "MMMM yyyy");
}

/** The day the timetable moves to: back or on one of its view (the list steps a month), or today. */
export function stepCursor(view: ScheduleView, cursor: string, today: string, dir: -1 | 0 | 1): string {
  if (dir === 0) return today;
  if (view === "day") return addDays(cursor, dir);
  if (view === "week") return addDays(cursor, 7 * dir);
  return addMonths(cursor, dir);
}

/**
 * The "+ Class", "+ PT Session" … buttons. Picking one arms the grid: slots
 * light up on hover and the next click chooses when the thing goes. Picking
 * the armed one again disarms it.
 */
export function AddKindButtons<K extends string>({
  kinds,
  armed,
  onArm,
}: {
  kinds: readonly { kind: K; label: string }[];
  armed: K | null;
  onArm: (kind: K | null) => void;
}) {
  return kinds.map((k) => (
    <Button
      key={k.kind}
      variant={armed === k.kind ? "primary" : "secondary"}
      size="sm"
      aria-pressed={armed === k.kind}
      onClick={() => onArm(armed === k.kind ? null : k.kind)}
    >
      <Plus className="h-4 w-4" /> {k.label}
    </Button>
  ));
}

export function PrevTodayNext({ onStep }: { onStep: (dir: -1 | 0 | 1) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => onStep(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="secondary" size="sm" className="h-9 sm:h-8" onClick={() => onStep(0)}>
        Today
      </Button>
      <Button variant="ghost" size="icon" aria-label="Next" onClick={() => onStep(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function FiltersButton({
  open,
  active,
  onToggle,
}: {
  open: boolean;
  /** How many filters are narrowing the grid; 0 is none. */
  active: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:ml-0 sm:h-8",
        active > 0 ? "border-accent/40 bg-accent/10 text-accent" : "bg-card text-muted hover:text-ink",
      )}
      aria-expanded={open}
    >
      <FilterIcon className="h-3.5 w-3.5" />
      Filters
      {active > 0 && (
        <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{active}</span>
      )}
    </button>
  );
}

/** The row of filter pills under the toolbar, with Clear all while any is set. */
export function FiltersRow({ children, onClear }: { children: React.ReactNode; onClear: (() => void) | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-paper/50 p-3 text-xs">
      {children}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto min-h-9 px-1 text-xs font-medium text-muted hover:text-ink sm:min-h-8"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

export function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { val: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 focus-within:ring-2 focus-within:ring-accent sm:h-8">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 truncate bg-transparent text-xs font-medium text-ink focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The Type filter's choices, the same on every timetable. */
export const TYPE_FILTER_OPTIONS = [
  { val: "all", label: "All" },
  { val: "class", label: "Class" },
  { val: "workshop", label: "Workshop" },
  { val: "pt", label: "Private" },
  { val: "corporate", label: "Corporate" },
];

/** The band under the toolbar while the grid is armed. */
export function PickSlotBanner({ what, onCancel }: { what: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-accent/30 bg-accent/[0.07] px-3 py-2 text-xs font-medium text-accent">
      <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
      Pick a slot on the grid to place the new {what}.
      <button
        type="button"
        onClick={onCancel}
        className="-my-1 ml-auto min-h-8 px-1 font-semibold underline underline-offset-2"
      >
        Cancel
      </button>
    </div>
  );
}

/** The tip under the legend on a timetable with "+ …" buttons. */
export const ADD_TIP = "Tip: hit a “+” button above, then click the slot it belongs in.";
