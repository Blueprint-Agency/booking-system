"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarPlus, CalendarX, Loader2, Repeat } from "lucide-react";
import { Badge, Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { SeriesPreviewList, blockingDates } from "@/components/schedule/series-preview";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDate, formatDateTime } from "@/lib/formatters";
import {
  endSeries,
  extendSeries,
  getSeries,
  previewExtend,
  seriesCadence,
  seriesErrorMessage,
  type EndResult,
  type Preview,
  type Series,
} from "@/lib/series";

/** `YYYY-MM-DD` → the same day, as `formatDate` reads an instant. */
const dayLabel = (date: string) => formatDate(`${date}T12:00:00`, "d MMM yyyy");

/**
 * The Class Series a class belongs to, on that class's page: what it repeats,
 * and the two things done to a series as a whole — extend it to a later last
 * date, or end it from a date. Everything else about this class is edited on
 * the class itself, as for any class.
 */
export function SeriesPanel({
  seriesId,
  classDate,
  onChanged,
}: {
  seriesId: string;
  /** This class's calendar day, the natural date to end the series from. */
  classDate: string;
  onChanged: () => void;
}) {
  const { api } = useWorkspace();
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<"extend" | "end" | null>(null);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    getSeries(api, seriesId).then(
      (s) => !cancelled && setSeries(s),
      (err) => !cancelled && setError(seriesErrorMessage(err, "Couldn't load the series")),
    );
    return () => {
      cancelled = true;
    };
  }, [api, seriesId, version]);

  const changed = () => {
    setVersion((v) => v + 1);
    onChanged();
  };

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Repeat className="h-4 w-4 text-muted" /> Part of a class series
            {series?.ended_from && <Badge tone="neutral">Ended</Badge>}
          </h2>
          {series ? (
            <p className="mt-1 text-sm text-muted">
              {seriesCadence(series)} · {dayLabel(series.first_date)} to {dayLabel(series.last_date)}
              {series.excluded_dates.length > 0 &&
                ` · ${series.excluded_dates.length} skipped ${series.excluded_dates.length === 1 ? "date" : "dates"}`}
              {series.ended_from && ` · ended from ${dayLabel(series.ended_from)}`}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">{error ?? "Loading…"}</p>
          )}
          <p className="mt-1 text-xs text-muted">
            Changes to this class only affect this class.
          </p>
        </div>
        {series && (
          <div className="flex gap-2">
            {!series.ended_from && (
              <Button variant="secondary" size="sm" onClick={() => setOpen("extend")}>
                <CalendarPlus className="h-3.5 w-3.5" /> Extend
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setOpen("end")}>
              <CalendarX className="h-3.5 w-3.5" /> End series
            </Button>
          </div>
        )}
      </div>

      {series && open === "extend" && (
        <ExtendDialog series={series} onClose={() => setOpen(null)} onDone={changed} />
      )}
      {series && open === "end" && (
        <EndDialog series={series} defaultFrom={classDate} onClose={() => setOpen(null)} onDone={changed} />
      )}
    </section>
  );
}

function ExtendDialog({
  series,
  onClose,
  onDone,
}: {
  series: Series;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useWorkspace();
  const [lastDate, setLastDate] = useState("");
  const [preview, setPreview] = useState<{ lastDate: string; result: Preview } | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = preview && preview.lastDate === lastDate ? preview.result : null;
  const blocking = current ? blockingDates(current.dates, skipped) : 0;
  const adding = current ? current.dates.filter((d) => !skipped.has(d.date)).length : 0;

  async function runPreview() {
    if (!api || !lastDate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await previewExtend(api, series.id, lastDate, []);
      setPreview({ lastDate, result });
      setSkipped(new Set(result.dates.filter((d) => d.clashes.length > 0).map((d) => d.date)));
    } catch (err) {
      setPreview(null);
      setError(seriesErrorMessage(err, "Preview failed"));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!api || !current || blocking > 0) return;
    setBusy(true);
    setError(null);
    try {
      await extendSeries(api, series.id, lastDate, [...skipped].sort());
      onDone();
      onClose();
    } catch (err) {
      setError(seriesErrorMessage(err, "Extend failed"));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Extend series"
      description={`${seriesCadence(series)}, currently until ${dayLabel(series.last_date)}. New classes use the series' settings; dates that already have a class are never repeated.`}
    >
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="extend-last">New last date</Label>
            <Input
              id="extend-last"
              type="date"
              min={series.last_date}
              value={lastDate}
              onChange={(e) => setLastDate(e.target.value)}
            />
          </div>
          <Button variant="secondary" onClick={runPreview} disabled={busy || !lastDate}>
            {busy && !current ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Preview
          </Button>
        </div>
        {current && (
          <div className="max-h-72 overflow-y-auto">
            <SeriesPreviewList
              dates={current.dates}
              skipped={skipped}
              onToggle={(date) =>
                setSkipped((prev) => {
                  const next = new Set(prev);
                  if (next.has(date)) next.delete(date);
                  else next.add(date);
                  return next;
                })
              }
            />
          </div>
        )}
        {blocking > 0 && (
          <p className="text-xs text-error">Untick the clashing dates, or fix the clash and preview again.</p>
        )}
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={commit} disabled={busy || !current || blocking > 0}>
          {busy && current ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {current && adding > 0 ? `Add ${adding} ${adding === 1 ? "class" : "classes"}` : "Extend"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function EndDialog({
  series,
  defaultFrom,
  onClose,
  onDone,
}: {
  series: Series;
  defaultFrom: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useWorkspace();
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EndResult | null>(null);

  // The page refreshes only once the dialog is dismissed: refreshing reloads
  // the class page, which would unmount this dialog and lose the list of booked
  // classes the admin still has to cancel.
  const close = () => {
    if (result) onDone();
    onClose();
  };

  async function commit() {
    if (!api || !fromDate) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await endSeries(api, series.id, fromDate));
    } catch (err) {
      setError(seriesErrorMessage(err, "Ending the series failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="End series"
      description="No more classes are created from this date. Its classes from then on with no bookings are cancelled now; classes with bookings are listed for you to cancel one by one, which refunds the members."
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="text-ink">
            Ended from {dayLabel(result.ended_from)}. Cancelled {result.cancelled_class_ids.length}{" "}
            {result.cancelled_class_ids.length === 1 ? "class" : "classes"} with no bookings.
          </p>
          {result.booked_classes.length > 0 ? (
            <div>
              <p className="mb-2 text-ink">
                {result.booked_classes.length === 1
                  ? "This class has bookings and is still on:"
                  : "These classes have bookings and are still on:"}
              </p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {result.booked_classes.map((b) => (
                  <li key={b.class_id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>{formatDateTime(b.starts_at)}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted">
                        {b.booked_count} booked
                      </span>
                      <Link
                        href={`/admin/schedule/class/${b.class_id}`}
                        className="text-xs font-semibold text-accent underline underline-offset-2"
                        onClick={close}
                      >
                        Open to cancel
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted">No class from that date had bookings.</p>
          )}
          <DialogFooter>
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="end-from">End from</Label>
            <Input
              id="end-from"
              type="date"
              min={series.first_date}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          {error && <p className="mt-3 text-xs text-error">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Keep series
            </Button>
            <Button variant="danger" onClick={commit} disabled={busy || !fromDate}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              End series
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
