"use client";

import { useId, useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A rule the member agrees to by booking, framed in the warning colour so it
 * is seen before the first Book tap rather than found after a lost credit.
 * Collapsed to its title so it doesn't push the schedule down; a tap opens
 * the rules, one short fact per line (`classPolicyPoints`).
 */
export function PolicyNotice({
  title,
  points,
  className,
}: {
  title: string;
  points: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <section
      aria-label={title}
      className={cn("rounded-2xl border-2 border-warning bg-warning/10", className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-bold text-ink sm:px-5"
      >
        <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <ul id={listId} hidden={!open} className="space-y-1.5 px-4 pb-3.5 text-sm text-ink/85 sm:px-5">
        {points.map((p) => (
          <li key={p} className="flex gap-2 leading-snug">
            <span aria-hidden className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
