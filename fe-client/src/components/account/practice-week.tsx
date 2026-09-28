"use client";

/**
 * My practice's week (#342): Monday to Sunday, a tall mat on each day for
 * every session attended there and a dashed one for every session still
 * booked, then the week's sessions by name and start time.
 *
 * The columns are decoration for sight; the caption says the count in words
 * (`rhythmSummary`) and the list names every session.
 */
import { cn } from "@/lib/utils";
import { rhythmSummary, weekDays, weekSessions, type PracticeData } from "@/lib/practice";
import { Mat, PracticeLegend } from "./practice-mats";

/** Mats a day's column has room for before it says "+n". */
const MATS_PER_DAY = 3;
const MAT = "h-16 w-3.5 rounded-[5px] sm:w-[18px]";

export function PracticeWeek({ summary, today }: { summary: PracticeData; today: string }) {
  const days = weekDays(summary, today);
  const sessions = weekSessions(summary);
  const anyBooked = days.some((d) => d.booked > 0);

  return (
    <figure className="m-0">
      <div aria-hidden className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => {
          const attended = Math.min(d.attended, MATS_PER_DAY);
          const booked = Math.min(d.booked, MATS_PER_DAY - attended);
          const more = d.attended + d.booked - attended - booked;
          return (
            <div key={d.date} className="flex flex-col items-center gap-1.5">
              <span className="flex h-[74px] items-end gap-[3px]">
                {Array.from({ length: attended }, (_, k) => (
                  <Mat key={`a${k}`} kind="attended" className={MAT} delay={i * 50 + k * 30} />
                ))}
                {Array.from({ length: booked }, (_, k) => (
                  <Mat key={`b${k}`} kind="booked" className={MAT} />
                ))}
                {attended + booked === 0 && !d.future && <Mat kind="empty" className={MAT} />}
              </span>
              <span className={cn("text-[11px] font-semibold leading-none", d.today ? "text-ink" : "text-muted")}>
                {d.weekday}
              </span>
              <span className="flex h-2 items-center gap-1">
                {d.today && <span className="block h-1 w-1 rounded-full bg-accent" />}
                {more > 0 && <span className="text-[9px] font-bold leading-none text-muted">+{more}</span>}
              </span>
            </div>
          );
        })}
      </div>
      {sessions.length > 0 && (
        <ul className="mt-3 grid gap-2 border-t border-ink/10 pt-3 text-[13px]">
          {sessions.map((s) => (
            <li key={s.key} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-ink">
                {s.day} · {s.name}
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-muted">
                {s.time}
                {s.booked && " · Booked"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <PracticeLegend booked={anyBooked} />
      <figcaption className="sr-only">{rhythmSummary(summary)}</figcaption>
    </figure>
  );
}
