"use client";

/**
 * My activity's week (#342): Monday to Sunday, a column per day filled with
 * the sessions attended there and a dashed cap for any still booked. A day
 * with sessions opens them when tapped, as the month's tiles do
 * (`PracticeDayDialog`).
 *
 * The columns are buttons named for the day and what it holds; the caption
 * says the week in words (`rhythmSummary`).
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { dayTitle, rhythmSummary, weekDays, type PracticeData } from "@/lib/practice";
import { Column, PracticeLegend } from "./practice-mats";
import { PracticeDayDialog } from "./practice-day";

/** Sessions a day's column holds before it is full; a busier day raises it. */
const MIN_SCALE = 3;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PracticeWeek({
  summary,
  today,
  onChanged,
}: {
  summary: PracticeData;
  today: string;
  /** A booking was cancelled from a day: the week is read again. */
  onChanged: () => void;
}) {
  const days = weekDays(summary, today);
  const anyBooked = days.some((d) => d.booked > 0);
  const anySessions = days.some((d) => d.attended + d.booked > 0);
  const scale = Math.max(MIN_SCALE, ...days.map((d) => d.attended + d.booked));
  const [open, setOpen] = useState<string | null>(null);

  return (
    <figure className="m-0 flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-2">
        {days.map((d, i) => {
          const count = d.attended + d.booked;
          const body = (
            <>
              <span aria-hidden className="h-3 text-[11px] font-bold leading-none tabular-nums text-ink">
                {count > 0 ? count : ""}
              </span>
              <Column
                attended={d.attended}
                booked={d.booked}
                scale={scale}
                delay={i * 60}
                future={d.future && count === 0}
                className="min-h-0 w-full max-w-8 flex-1"
              />
              {/* Today: the weekday in bold ink, as the month marks it. */}
              <span
                aria-hidden
                className={cn("text-[11px] leading-none", d.today ? "font-extrabold text-ink" : "font-semibold text-muted")}
              >
                {d.weekday}
              </span>
            </>
          );
          const column = "flex h-full min-h-0 flex-col items-center gap-2 rounded-xl py-1";
          if (count === 0) {
            return (
              <div key={d.date} aria-hidden className={column}>
                {body}
              </div>
            );
          }
          const said = [
            d.attended > 0 ? `${plural(d.attended, "session")} attended` : null,
            d.booked > 0 ? `${d.booked} booked` : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setOpen(d.date)}
              aria-label={`${dayTitle(d.date)}${d.today ? " (today)" : ""}: ${said}`}
              className={cn(
                column,
                "transition-colors hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-ink/[0.05]",
              )}
            >
              {body}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <PracticeLegend
          items={[
            { swatch: "solid", label: "Attended" },
            ...(anyBooked ? [{ swatch: "dashed" as const, label: "Booked" }] : []),
          ]}
        />
        {anySessions && <p className="mt-4 text-xs text-muted">Tap a day to see its sessions</p>}
      </div>
      <figcaption className="sr-only">{rhythmSummary(summary)}</figcaption>
      {open && <PracticeDayDialog date={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </figure>
  );
}
