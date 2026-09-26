"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface RadioOption<V extends string> {
  value: V;
  label: string;
}

/**
 * One choice from a short list, each option a full-width row that is easy to
 * hit on a phone. Native radio inputs underneath, so arrow keys, focus and
 * screen readers behave as they do everywhere else. `value` null means nothing
 * is picked yet — a question that must be answered, not defaulted.
 */
export function RadioGroup<V extends string>({
  value,
  onValueChange,
  options,
  label,
  disabled,
  className,
}: {
  value: V | null;
  onValueChange: (v: V) => void;
  options: RadioOption<V>[];
  /** Read out as the group's name. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("space-y-2", className)}>
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
              checked ? "border-accent bg-accent/5 text-ink" : "border-border bg-card text-ink hover:border-accent/40",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onValueChange(o.value)}
              className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="min-w-0">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
