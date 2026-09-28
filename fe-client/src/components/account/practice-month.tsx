"use client";

/**
 * My activity's month (#340): a calendar, Monday first, each day a tile. A day
 * the member attended is solid in the studio's accent, a day with a session
 * still booked is outlined dashed, and either carries a dot per session under
 * its date (up to three) and opens that day's sessions when tapped. A day that
 * passed with nothing on it is a faint tile. A tapped day lists its bookings
 * as My bookings' cards (`PracticeDayDialog`). The tiles settle in one after
 * another on load; with reduced motion they are simply there.
 *
 * The grid is decoration for sight — its tiles are buttons named for the day
 * and what it holds — and the figure's caption says the month in words
 * (`rhythmSummary`).
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { dayTitle, monthGrid, rhythmSummary, type PracticeData } from "@/lib/practice";
import { PracticeLegend } from "./practice-mats";
import { PracticeDayDialog } from "./practice-day";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
/** Dots a tile has room for; a busier day still shows three. */
const MAX_DOTS = 3;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PracticeMonth({
  summary,
  today,
  onChanged,
}: {
  summary: PracticeData;
  today: string;
  /** A booking was cancelled from a day: the month is read again. */
  onChanged: () => void;
}) {
  const { leading, days } = monthGrid(summary, today);
  const anyBooked = days.some((d) => d.booked > 0);
  const anySessions = days.some((d) => d.attended + d.booked > 0);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <figure className="m-0">
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEKDAYS.map((d, i) => (
          <span key={i} aria-hidden className="pb-1 text-center text-[11px] font-semibold text-muted">
            {d}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden />
        ))}
        {days.map((d, i) => {
          const sessions = d.attended + d.booked;
          const tile = cn(
            "practice-pop flex h-11 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold tabular-nums",
            d.attended > 0
              ? "bg-accent text-inverse"
              : d.booked > 0
                ? "border-[1.5px] border-dashed border-accent text-accent-deep"
                : d.future
                  ? "text-muted/60"
                  : "bg-ink/[0.04] text-muted",
            d.today && "ring-2 ring-ink ring-offset-2 ring-offset-card",
          );
          const style = { animationDelay: `${i * 14}ms` };
          if (sessions === 0) {
            return (
              <span key={d.date} aria-hidden className={tile} style={style}>
                {d.day}
              </span>
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
              aria-label={`${dayTitle(d.date)}: ${said}`}
              className={cn(
                tile,
                "transition-transform hover:scale-[1.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-95",
              )}
              style={style}
            >
              <span className="leading-none">{d.day}</span>
              <span aria-hidden className="flex h-1 gap-[3px]">
                {Array.from({ length: Math.min(sessions, MAX_DOTS) }, (_, k) => (
                  <span key={k} className="block h-1 w-1 rounded-full bg-current opacity-90" />
                ))}
              </span>
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
