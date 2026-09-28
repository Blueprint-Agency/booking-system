"use client";

import { cn } from "@/lib/utils";

/**
 * The second level under a `SegmentedTabs`: plain words on a hairline, the
 * chosen one underlined. Quieter than the pills above it, so the page reads
 * top-down — family first, then kind — instead of two pill rows competing.
 * Scrolls sideways on a phone rather than wrapping if a studio's labels run
 * long.
 */
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (t: T) => void;
  /** What the tabs switch between, for screen readers. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto no-scrollbar", className)}>
      <div role="tablist" aria-label={label} className="flex min-w-full w-max gap-6 border-b border-ink/10">
        {tabs.map((t) => {
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(t.value)}
              className={cn(
                "-mb-px min-h-[44px] whitespace-nowrap border-b-2 text-sm font-semibold transition-colors",
                selected
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
