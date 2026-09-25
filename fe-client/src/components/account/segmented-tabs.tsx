"use client";

import { cn } from "@/lib/utils";

/**
 * The one tab control for the account's booking lists. Fills the width on a
 * phone so every tab is a thumb-sized target, and scrolls rather than wraps
 * if a list ever has more tabs than fit.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  counts,
  label,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (t: T) => void;
  counts?: Partial<Record<T, number>>;
  /** What the tabs switch between, for screen readers. */
  label: string;
}) {
  return (
    <div className="mb-4 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar">
      <div
        role="tablist"
        aria-label={label}
        className="flex w-max min-w-full sm:min-w-0 rounded-full bg-ink/5 p-1"
      >
        {tabs.map((t) => {
          const selected = t.value === value;
          const count = counts?.[t.value];
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(t.value)}
              className={cn(
                "flex flex-1 sm:flex-none items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-full px-2.5 sm:px-4 min-h-[40px] text-[13px] sm:text-sm font-semibold transition-colors",
                selected ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
              {count !== undefined && (
                <span
                  className={cn(
                    "min-w-[1.25rem] rounded-full px-1.5 text-[11px] font-bold tabular-nums leading-5",
                    selected ? "bg-accent/10 text-accent-deep" : "bg-ink/5 text-muted",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
