"use client";

/**
 * My practice's year (#342): a column per month, a small mat per session
 * stacked in it with the month's count on top, and dashed mats for what is
 * still booked this month. Months not yet reached are left empty and their
 * initials faded, so the rest of the year never reads as a drop to zero.
 *
 * Every column shares one scale: a busy year thins its mats rather than let a
 * column run off the card, so a taller stack is always more sessions.
 *
 * The columns are decoration for sight; the caption says the count in words
 * (`rhythmSummary`).
 */
import { cn } from "@/lib/utils";
import { rhythmSummary, yearColumns, type PracticeData } from "@/lib/practice";
import { Mat, PracticeLegend } from "./practice-mats";

/** The stack's height, and a mat's thickness and the gap under it at most. */
const STACK_PX = 124;
const MAT_PX = 7;
const GAP_PX = 2;

export function PracticeYear({ summary, today }: { summary: PracticeData; today: string }) {
  const columns = yearColumns(summary, today);
  const anyBooked = columns.some((c) => c.booked > 0);
  const most = Math.max(1, ...columns.map((c) => c.attended + c.booked));
  const gap = most * (MAT_PX + GAP_PX) > STACK_PX ? 1 : GAP_PX;
  const thickness = Math.max(2, Math.min(MAT_PX, Math.floor(STACK_PX / most) - gap));

  return (
    <figure className="m-0">
      <div aria-hidden className="grid grid-cols-12 items-end gap-1">
        {columns.map((c, i) => (
          <div key={c.month} className="flex min-w-0 flex-col items-center gap-1">
            <span className="min-h-[15px] text-[10px] font-bold tabular-nums text-ink">
              {c.future || c.attended === 0 ? "" : c.attended}
            </span>
            <span className="flex w-full flex-col-reverse items-center" style={{ minHeight: STACK_PX, gap }}>
              {Array.from({ length: c.attended }, (_, k) => (
                <Mat
                  key={`a${k}`}
                  kind="attended"
                  className="w-full max-w-4 rounded-[2px]"
                  style={{ height: thickness }}
                  delay={i * 40 + k * 12}
                />
              ))}
              {Array.from({ length: c.booked }, (_, k) => (
                <Mat
                  key={`b${k}`}
                  kind="booked"
                  className="w-full max-w-4 rounded-[2px] border"
                  style={{ height: Math.max(thickness, 4) }}
                />
              ))}
            </span>
            <span
              className={cn(
                "text-[10px] font-semibold leading-none",
                c.current ? "text-ink" : "text-muted",
                c.future && "opacity-50",
              )}
            >
              {c.initial}
            </span>
          </div>
        ))}
      </div>
      <PracticeLegend booked={anyBooked} />
      <figcaption className="sr-only">{rhythmSummary(summary)}</figcaption>
    </figure>
  );
}
