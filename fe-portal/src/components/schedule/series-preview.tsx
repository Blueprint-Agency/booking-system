"use client";
import { AlertTriangle } from "lucide-react";
import { formatDate, formatTime } from "@/lib/formatters";
import type { PreviewDate } from "@/lib/series";

/**
 * Every date a Class Series create or extend would produce, with its clashes.
 * Unticking a date skips it (it becomes an excluded date); a clashing date has
 * to be skipped, or the clash fixed and the preview re-run, before anything can
 * be created — the commit is all or nothing.
 */
export function SeriesPreviewList({
  dates,
  skipped,
  onToggle,
}: {
  dates: PreviewDate[];
  skipped: ReadonlySet<string>;
  onToggle: (date: string) => void;
}) {
  if (dates.length === 0) {
    return <p className="px-1 py-4 text-sm text-muted">No new dates in that range.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {dates.map((d) => {
        const skip = skipped.has(d.date);
        const blocking = d.clashes.length > 0 && !skip;
        return (
          <li
            key={d.date}
            className={`flex items-start gap-3 px-3 py-2 text-sm ${blocking ? "bg-error/5" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-accent"
              checked={!skip}
              onChange={() => onToggle(d.date)}
              aria-label={`Create a class on ${formatDate(d.starts_at, "EEE d MMM yyyy")}`}
            />
            <div className="min-w-0 flex-1">
              <div className={skip ? "text-muted line-through" : "text-ink"}>
                <span className="font-medium">{formatDate(d.starts_at, "EEE d MMM yyyy")}</span>{" "}
                <span className="tabular-nums text-muted">
                  {formatTime(d.starts_at)}–{formatTime(d.ends_at)}
                </span>
              </div>
              {d.clashes.map((c) => (
                <div
                  key={`${c.subject}-${c.subject_id}`}
                  className={`mt-0.5 flex items-start gap-1 text-xs ${skip ? "text-muted" : "text-error"}`}
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {c.message}
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Dates that still block a commit: clashing and not skipped. */
export function blockingDates(dates: PreviewDate[], skipped: ReadonlySet<string>): number {
  return dates.filter((d) => d.clashes.length > 0 && !skipped.has(d.date)).length;
}
