"use client";

/**
 * My practice's month (#340): a calendar, Monday first, with a yoga mat laid
 * on each day for every session attended there, and a dashed one for every
 * session still booked. Mats are drawn at a mat's own proportions in the
 * studio's accent, so the count and the habit read at the same glance and
 * every studio's page wears its own colour, in either theme.
 *
 * The grid is decoration for sight; the figure's caption says the same thing
 * in words (`rhythmSummary`).
 */
import { cn } from "@/lib/utils";
import { monthGrid, rhythmSummary, type PracticeData } from "@/lib/practice";
import { Mat, PracticeLegend } from "./practice-mats";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
/** Mats a day's cell has room for before it says "+n". */
const MATS_PER_DAY = 3;
const MAT = "h-6 w-2 rounded-[3px]";

export function PracticeMonth({ summary, today }: { summary: PracticeData; today: string }) {
  const { leading, days } = monthGrid(summary, today);
  const anyBooked = days.some((d) => d.booked > 0);

  return (
    <figure className="m-0">
      <div aria-hidden className="grid grid-cols-7 gap-x-1 gap-y-2 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-[10px] font-bold tracking-wider text-muted">
            {d}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {days.map((d) => {
          const attended = Math.min(d.attended, MATS_PER_DAY);
          const booked = Math.min(d.booked, MATS_PER_DAY - attended);
          const more = d.attended + d.booked - attended - booked;
          return (
            <div key={d.date} className="flex min-h-11 flex-col items-center gap-[3px]">
              <span
                className={cn(
                  "text-[10px] leading-none tabular-nums",
                  d.today ? "rounded-full bg-accent px-1.5 py-0.5 font-extrabold text-inverse" : "text-muted",
                )}
              >
                {d.day}
              </span>
              <span className="flex items-end gap-0.5">
                {Array.from({ length: attended }, (_, k) => (
                  <Mat key={`a${k}`} kind="attended" className={MAT} delay={d.day * 18 + k * 30} />
                ))}
                {Array.from({ length: booked }, (_, k) => (
                  <Mat key={`b${k}`} kind="booked" className={MAT} />
                ))}
                {attended + booked === 0 && !d.future && <Mat kind="empty" className={MAT} />}
              </span>
              {more > 0 && <span className="text-[9px] font-bold leading-none text-muted">+{more}</span>}
            </div>
          );
        })}
      </div>
      <PracticeLegend booked={anyBooked} />
      <figcaption className="sr-only">{rhythmSummary(summary)}</figcaption>
    </figure>
  );
}
