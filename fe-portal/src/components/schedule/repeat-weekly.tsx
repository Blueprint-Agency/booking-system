"use client";
import { useState } from "react";
import { CalendarSearch, Loader2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { SeriesPreviewList, blockingDates } from "@/components/schedule/series-preview";
import { ApiError, type Api } from "@/lib/api";
import { todayIso } from "@/lib/formatters";
import { lastDateLimit } from "@/lib/repeat-weekly";
import {
  createSeries,
  previewSeries,
  repeatsEvery,
  seriesErrorMessage,
  type OwnSeriesInput,
  type Preview,
  type SeriesInput,
  type SeriesRole,
} from "@/lib/series";

/**
 * The class screen's **Repeat weekly** switch, admin and instructor alike. Off,
 * the screen makes one class; on, it makes a Class Series: every date is
 * previewed with its clashes before anything is created.
 */
export function RepeatWeeklySwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        // The before: box widens the hit area to thumb size without growing the switch.
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          checked ? "bg-accent" : "bg-border"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      Repeat weekly
    </label>
  );
}

/**
 * The range of a weekly repeat, as cells of the When grid after the first date
 * and times: the weekday, read-only and taken from the first date, then the
 * last date, at most a year on.
 */
export function RepeatRangeFields({
  firstDate,
  lastDate,
  onLastDateChange,
}: {
  firstDate: string;
  lastDate: string;
  onLastDateChange: (next: string) => void;
}) {
  const every = repeatsEvery(firstDate);
  return (
    <>
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-ink">Repeats</span>
        <p className="flex h-10 items-center text-sm text-ink" aria-live="polite">
          {every ?? <span className="text-muted">Pick a first date</span>}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="last">Last date</Label>
        <Input
          id="last"
          required
          type="date"
          min={firstDate || todayIso()}
          max={lastDateLimit(firstDate) || undefined}
          value={lastDate}
          onChange={(e) => onLastDateChange(e.target.value)}
        />
      </div>
      <p className="col-span-full text-xs text-muted">
        Up to one year at a time. Times are the studio&apos;s local time.
      </p>
    </>
  );
}

/** The Cancellation Window field's hint with Repeat weekly on. */
export const SERIES_WINDOW_HINT =
  "Copied onto every class in the series. Leave blank to follow the studio's cancellation policy.";

export type SeriesDates = ReturnType<typeof useSeriesDates>;

/**
 * A series' dates: preview, tick, commit. `input` is the form as the API takes
 * it, or the sentence saying what is still missing. Any change to it after a
 * preview makes that preview stale, so the commit always sends exactly what
 * the staff member last saw.
 */
export function useSeriesDates(
  api: Api | null,
  role: SeriesRole,
  input: SeriesInput | OwnSeriesInput | string,
) {
  const [preview, setPreview] = useState<{ key: string; result: Preview } | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputKey = typeof input === "string" ? null : JSON.stringify(input);
  const current = preview && preview.key === inputKey ? preview.result : null;
  const blocking = current ? blockingDates(current.dates, skipped) : 0;
  /** How many classes a commit makes now; null until the dates are previewed. */
  const creating = current ? current.dates.filter((d) => !skipped.has(d.date)).length : null;

  /**
   * `after` re-previews after a refused create: the staff member's own skips (a
   * holiday) survive, and the refusal stays on screen to say why the list changed.
   */
  async function runPreview(after?: { keep: ReadonlySet<string>; notice: string }) {
    if (!api) return;
    if (typeof input === "string") return setError(input);
    setBusy("preview");
    setError(after?.notice ?? null);
    try {
      const result = await previewSeries(api, role, input);
      setPreview({ key: JSON.stringify(input), result });
      // Clashing dates start unticked: they're ticked back once the clash is fixed.
      const clashing = result.dates.filter((d) => d.clashes.length > 0).map((d) => d.date);
      setSkipped(new Set([...(after?.keep ?? []), ...clashing]));
    } catch (err) {
      setPreview(null);
      setError(seriesErrorMessage(err, "Preview failed"));
    } finally {
      setBusy(null);
    }
  }

  /** Commit the previewed dates. True once every class is created. */
  async function create(): Promise<boolean> {
    if (!api || typeof input === "string" || !current || blocking > 0) return false;
    setBusy("create");
    setError(null);
    try {
      await createSeries(api, role, { ...input, excluded_dates: [...skipped].sort() });
      return true;
    } catch (err) {
      const notice = seriesErrorMessage(err, "Failed to create classes");
      setError(notice);
      setBusy(null);
      // Something changed since the preview (a class booked into the room);
      // show the dates as they are now.
      if (err instanceof ApiError && err.status === 409) void runPreview({ keep: skipped, notice });
      return false;
    }
  }

  const toggle = (date: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  return {
    current,
    /** A preview was run, then the form changed. */
    stale: preview !== null && current === null,
    skipped,
    toggle,
    blocking,
    creating,
    busy,
    error,
    runPreview,
    create,
    canCreate: busy === null && current !== null && blocking === 0 && (creating ?? 0) > 0,
  };
}

/** The Dates card: preview every date, untick the ones to skip. */
export function SeriesDatesSection({ dates }: { dates: SeriesDates }) {
  const { current, stale, skipped, toggle, blocking, busy, runPreview } = dates;
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Dates</h2>
          <p className="text-xs text-muted">Untick a date to skip it, such as a public holiday.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void runPreview()} disabled={busy !== null}>
          {busy === "preview" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarSearch className="h-4 w-4" />
          )}
          {current ? "Preview again" : "Preview dates"}
        </Button>
      </div>
      {current ? (
        <>
          <SeriesPreviewList dates={current.dates} skipped={skipped} onToggle={toggle} />
          {blocking > 0 && (
            <p className="mt-2 text-xs text-error">
              {blocking} ticked {blocking === 1 ? "date clashes" : "dates clash"}. Untick{" "}
              {blocking === 1 ? "it" : "them"}, or fix the clash and preview again.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">
          {stale
            ? "The form changed. Preview again to see the dates."
            : "Preview to see every date before anything is created."}
        </p>
      )}
    </section>
  );
}
