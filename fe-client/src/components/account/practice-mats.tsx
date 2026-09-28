"use client";

/**
 * The marks My practice (#340) draws its week, month and year with: a yoga mat
 * per session, solid in the studio's accent when attended, dashed when still
 * booked, a faint one for a day that passed with nothing on it. Each view sets
 * the mat's size; the legend under every chart is the same.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export function Mat({
  kind,
  className,
  delay,
  style,
}: {
  kind: "attended" | "booked" | "empty";
  /** The mat's size and corners. */
  className: string;
  /** Milliseconds before it is laid down; attended mats only. */
  delay?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "block shrink-0",
        kind === "attended" && "mat-lay bg-accent",
        kind === "booked" && "border-[1.5px] border-dashed border-accent",
        kind === "empty" && "bg-ink/[0.07]",
        className,
      )}
      style={kind === "attended" && delay !== undefined ? { ...style, animationDelay: `${delay}ms` } : style}
    />
  );
}

export function PracticeLegend({ booked }: { booked: boolean }) {
  return (
    <div aria-hidden className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="block h-4 w-[7px] rounded-[3px] bg-accent" />
        Attended
      </span>
      {booked && (
        <span className="inline-flex items-center gap-1.5">
          <span className="block h-4 w-[7px] rounded-[3px] border-[1.5px] border-dashed border-accent" />
          Booked
        </span>
      )}
    </div>
  );
}
