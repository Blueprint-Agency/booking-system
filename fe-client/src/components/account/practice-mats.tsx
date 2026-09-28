"use client";

/**
 * The marks My activity (#340) draws its week and year with, and the legend
 * under every chart. A column is a faint rounded track with the period's
 * sessions filled up from its foot in the studio's accent — solid for
 * attended, a dashed cap for what is still booked — so every studio's page
 * wears its own colour, in either theme. Columns grow in on load; with reduced
 * motion they are simply there.
 */
import { cn } from "@/lib/utils";

export function Column({
  attended,
  booked,
  scale,
  delay,
  future = false,
  className,
}: {
  attended: number;
  booked: number;
  /** The count that fills the track; every column in a chart shares it. */
  scale: number;
  /** Milliseconds before the column grows in. */
  delay: number;
  /** Not reached yet: the track is faded, never read as a zero. */
  future?: boolean;
  /** The track's size. */
  className: string;
}) {
  const share = (n: number) => `${Math.min(1, n / scale) * 100}%`;
  return (
    <span
      className={cn(
        "relative flex flex-col-reverse gap-[3px] overflow-hidden rounded-full bg-ink/[0.05]",
        future && "opacity-50",
        className,
      )}
    >
      {attended > 0 && (
        <span
          className="practice-grow block w-full shrink-0 rounded-full bg-accent"
          style={{ height: share(attended), animationDelay: `${delay}ms` }}
        />
      )}
      {booked > 0 && (
        <span
          className="practice-grow block w-full shrink-0 rounded-full border-[1.5px] border-dashed border-accent"
          style={{ height: share(booked), animationDelay: `${delay + 120}ms` }}
        />
      )}
    </span>
  );
}

/** A key's swatch and its words. */
export type LegendItem = { swatch: "solid" | "soft" | "dashed"; label: string };

export function PracticeLegend({ items }: { items: LegendItem[] }) {
  return (
    <div aria-hidden className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "block h-2.5 w-2.5 rounded-[3px]",
              item.swatch === "solid" && "bg-accent",
              item.swatch === "soft" && "bg-accent/30",
              item.swatch === "dashed" && "border-[1.5px] border-dashed border-accent",
            )}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
