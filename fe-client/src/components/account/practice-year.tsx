"use client";

/**
 * My activity's year (#342): a column per month filled with the sessions
 * attended in it, the count on top, and a dashed cap for what is still booked
 * this month. Months not yet reached keep a faded track and initial, so the
 * rest of the year never reads as a drop to zero.
 *
 * Every column shares one scale, so a taller column is always more sessions.
 *
 * The columns are decoration for sight; the caption says the count in words
 * (`rhythmSummary`).
 */
import { cn } from "@/lib/utils";
import { rhythmSummary, yearColumns, type PracticeData } from "@/lib/practice";
import { Column, PracticeLegend } from "./practice-mats";

export function PracticeYear({ summary, today }: { summary: PracticeData; today: string }) {
  const columns = yearColumns(summary, today);
  const anyBooked = columns.some((c) => c.booked > 0);
  const scale = Math.max(1, ...columns.map((c) => c.attended + c.booked));

  return (
    <figure className="m-0 flex h-full flex-col">
      <div aria-hidden className="grid min-h-0 flex-1 grid-cols-12 gap-1 sm:gap-1.5">
        {columns.map((c, i) => (
          <div key={c.month} className="flex h-full min-h-0 min-w-0 flex-col items-center gap-2 py-1">
            <span className="h-3 text-[10px] font-bold leading-none tabular-nums text-ink">
              {c.future || c.attended === 0 ? "" : c.attended}
            </span>
            <Column
              attended={c.attended}
              booked={c.booked}
              scale={scale}
              delay={i * 45}
              future={c.future}
              className="min-h-0 w-full max-w-5 flex-1"
            />
            <span
              className={cn(
                "text-[10px] leading-none",
                c.current ? "font-extrabold text-ink" : "font-semibold text-muted",
                c.future && "opacity-50",
              )}
            >
              {c.initial}
            </span>
          </div>
        ))}
      </div>
      <PracticeLegend
        items={[
          { swatch: "solid", label: "Attended" },
          ...(anyBooked ? [{ swatch: "dashed" as const, label: "Booked" }] : []),
        ]}
      />
      <figcaption className="sr-only">{rhythmSummary(summary)}</figcaption>
    </figure>
  );
}
