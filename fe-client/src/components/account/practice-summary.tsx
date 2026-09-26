"use client";

/**
 * "Your practice" on the account overview (#317): how many group classes the
 * member attended in a timeframe, against the one before, laid out as a punch
 * card — a band in the studio's accent with a hole cut for every class, one
 * column per week, month or year.
 *
 * Studio passes were once punched cards, and the next-class card above is
 * already a ticket, so the band is the one distinctive thing here; everything
 * around it is the account's own eyebrow, count, tabs and card.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CARD } from "@/components/ui/styles";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import {
  HOLES_PER_COLUMN,
  PRACTICE_PERIODS,
  bandSummary,
  bucketLabels,
  classNoun,
  comparisonLine,
  emptyLine,
  lastClassLine,
  punches,
  type PracticeBucket,
  type PracticeData,
  type PracticePeriod,
} from "@/lib/practice";

const HOLE_PX = 8;
const GAP_PX = 3;
/** Room above the holes for a column's "+n". */
const MORE_PX = 14;
/** The band is never shorter than this many holes, so a quiet week still reads as a card. */
const MIN_ROWS = 3;

export function PracticeSummary() {
  const api = useApi();
  const [period, setPeriod] = useState<PracticePeriod>("month");
  // Each timeframe once: switching back to one already read shows it at once.
  const [loaded, setLoaded] = useState<Partial<Record<PracticePeriod, PracticeData>>>({});
  const [failed, setFailed] = useState<PracticePeriod | null>(null);

  const load = useCallback(
    async (p: PracticePeriod) => {
      setFailed(null);
      try {
        const summary = await api.get<PracticeData>("/me/bookings/attendance", { period: p });
        setLoaded((prev) => ({ ...prev, [p]: summary }));
      } catch (err) {
        reportError(err, { scope: "practice-summary" });
        setFailed(p);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!loaded[period]) load(period);
    // `loaded` is left out on purpose: a timeframe arriving must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, load]);

  const summary = loaded[period];

  return (
    <section aria-labelledby="practice-heading" className={cn(CARD, "mb-6 p-4 sm:p-5")}>
      <h2
        id="practice-heading"
        className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted"
      >
        Your practice
      </h2>
      <SegmentedTabs tabs={PRACTICE_PERIODS} value={period} onChange={setPeriod} label="Timeframe" />

      {failed === period ? (
        <div className="flex items-center justify-between gap-3 py-2">
          <p className="text-sm text-muted">Couldn&apos;t load your practice summary.</p>
          <button
            type="button"
            onClick={() => load(period)}
            className="shrink-0 text-sm font-semibold text-accent-deep hover:text-accent min-h-[44px]"
          >
            Try again
          </button>
        </div>
      ) : !summary ? (
        <div aria-busy="true" aria-label="Loading your practice summary">
          <div className="h-8 w-32 rounded-lg bg-ink/[0.06] animate-pulse" />
          <div
            className="mt-4 rounded-xl bg-ink/[0.06] animate-pulse"
            style={{ height: bandHeight(MIN_ROWS) + 24 }}
          />
        </div>
      ) : (
        <PracticeBody summary={summary} />
      )}
    </section>
  );
}

function PracticeBody({ summary }: { summary: PracticeData }) {
  const { period, attended } = summary;
  const comparison = comparisonLine(period, attended, summary.previous_attended);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-extrabold text-ink tabular-nums leading-none">
          <span className="text-3xl sm:text-4xl">{attended}</span>{" "}
          <span className="text-base font-bold">{classNoun(attended)}</span>
        </p>
        {comparison && <p className="text-sm text-muted">{comparison}</p>}
      </div>

      {/* Keyed by timeframe, so the holes punch in again when it changes. */}
      <PunchBand key={period} period={period} buckets={summary.buckets} />

      {attended === 0 ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">{emptyLine(period)}</p>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent-deep hover:text-accent min-h-[44px]"
          >
            Book a class
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-6">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-muted">Most practised</h3>
            <ol className="mt-1.5 space-y-1">
              {summary.top_class_types.map((t) => (
                <li key={t.name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-ink">{t.name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{t.attended}</span>
                </li>
              ))}
            </ol>
          </div>
          {summary.last_attended_at && (
            <p className="text-sm text-muted">{lastClassLine(summary.last_attended_at)}</p>
          )}
        </div>
      )}
    </>
  );
}

function bandHeight(rows: number): number {
  return rows * HOLE_PX + (rows - 1) * GAP_PX + MORE_PX;
}

/**
 * The punch card. Each column stacks its holes from the bottom, up to eight,
 * then says "+n"; an empty one is a hairline dash. The holes are paper
 * showing through, so the studio's accent is the card and nothing else.
 */
function PunchBand({ period, buckets }: { period: PracticePeriod; buckets: PracticeBucket[] }) {
  const labels = bucketLabels(period, buckets);
  const tallest = Math.max(0, ...buckets.map((b) => Math.min(b.attended, HOLES_PER_COLUMN)));
  const height = bandHeight(Math.max(MIN_ROWS, tallest));
  const columns = { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` };

  return (
    <figure className="mt-4">
      <div aria-hidden className="rounded-xl bg-accent px-2.5 py-3">
        <div className="grid gap-x-1" style={columns}>
          {buckets.map((b, col) => {
            const { holes, more } = punches(b.attended);
            return (
              <div
                key={b.starts_on}
                className="flex flex-col-reverse items-center"
                style={{ height, gap: GAP_PX }}
              >
                {holes === 0 ? (
                  <span className="h-px w-3 max-w-full bg-inverse/40" style={{ marginBottom: HOLE_PX / 2 }} />
                ) : (
                  Array.from({ length: holes }, (_, row) => (
                    <span
                      key={row}
                      className="punch-hole shrink-0 rounded-full bg-paper shadow-[inset_0_1px_1.5px_rgba(13,26,62,0.45)]"
                      // Left to right, bottom to top, once.
                      style={{ width: HOLE_PX, height: HOLE_PX, animationDelay: `${col * 45 + row * 20}ms` }}
                    />
                  ))
                )}
                {more > 0 && (
                  <span className="mb-auto text-[10px] font-bold leading-none tabular-nums text-inverse/85">
                    +{more}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div aria-hidden className="mt-1.5 grid gap-x-1 px-2.5" style={columns}>
        {labels.map((label, i) => (
          <span
            key={buckets[i]!.starts_on}
            className="whitespace-nowrap text-center text-[10px] font-semibold leading-none text-muted"
          >
            {label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        <ul>
          {bandSummary(period, buckets).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
