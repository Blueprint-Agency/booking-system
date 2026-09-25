"use client";

import { cn } from "@/lib/utils";

/**
 * A row of one-of-several chips — a location, a package type. The second
 * level under a `SegmentedTabs`, or a filter on its own. Labels can be a
 * studio's own long names, so the row scrolls sideways on a phone rather than
 * wrapping or widening the page.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** What the chips choose between, for screen readers. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto no-scrollbar", className)}>
      <div className="flex w-max gap-2" role="group" aria-label={label}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "min-h-[40px] whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors",
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/10 bg-card text-muted hover:border-ink/25 hover:text-ink",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
