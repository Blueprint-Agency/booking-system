"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { PracticeMonth } from "@/components/account/practice-month";
import { PracticeWeek } from "@/components/account/practice-week";
import { PracticeYear } from "@/components/account/practice-year";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { BTN_BOOK, BTN_SECONDARY, CARD } from "@/components/ui/styles";
import { useHoldLoader } from "@/lib/loading-store";
import { cn } from "@/lib/utils";
import { usePractice, type PracticeView } from "@/lib/use-practice";
import {
  breakdownLine,
  comparisonLine,
  durationLabel,
  emptyLine,
  headline,
  isCurrent,
  lifetimeLine,
  practiceBars,
  rangeLabel,
  stepAnchor,
  streakLabel,
  studioToday,
  usualSlotLabel,
  workshopLine,
  type PracticeData,
} from "@/lib/practice";

const VIEWS: { value: PracticeView; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

/**
 * My practice (#340, #342): what the member attended in a week, month or year
 * — group classes and private sessions — as a sentence, a chart of mats, three
 * figures and the class types they practised most, with their lifetime total
 * under the title. It opens on this month; ‹ › step back through earlier
 * periods as far as the backend allows (`has_previous`, `has_next`), and
 * switching period returns to the current one. Every figure is the backend's
 * (`GET /me/bookings/attendance`); the words are `lib/practice.ts`.
 */
export default function PracticePage() {
  const [view, setView] = useState<PracticeView>("month");
  // The day whose period is shown; null for the one containing today.
  const [on, setOn] = useState<string | null>(null);
  const { shown, pending, loading, failed, retry } = usePractice(view, on);
  // The page arrives whole: it waits under the loader for its first read, and
  // after that keeps the last period up while the next loads.
  useHoldLoader(loading && !shown);

  const switchView = (next: PracticeView) => {
    setView(next);
    setOn(null);
  };

  return (
    <div className="max-w-2xl">
      <AccountPageHeader title="My practice" description={shown ? lifetimeLine(shown.lifetime) : undefined} />

      <SegmentedTabs label="Period" tabs={VIEWS} value={view} onChange={switchView} />

      {failed ? (
        <div className={cn(CARD, "p-8 text-center")}>
          <p className="text-sm text-muted">Couldn&apos;t load your practice.</p>
          <button type="button" onClick={retry} className={cn(BTN_SECONDARY, "mt-4 min-h-[44px]")}>
            Try again
          </button>
        </div>
      ) : shown ? (
        <PracticeBody
          summary={shown}
          pending={pending}
          onStep={(direction) => setOn(stepAnchor(shown, direction))}
        />
      ) : null}
    </div>
  );
}

function PracticeBody({
  summary,
  pending,
  onStep,
}: {
  summary: PracticeData;
  /** `summary` is the last period's, standing in while the chosen one loads. */
  pending: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  const everAttended = summary.lifetime.attended > 0;
  const { count, label } = headline(summary);
  const comparison = comparisonLine(summary);
  const breakdown = breakdownLine(summary.attended_classes, summary.attended_pt);
  const workshops = workshopLine(summary);
  const bars = practiceBars(summary);
  const today = studioToday(Date.now());

  return (
    <div aria-busy={pending} className={cn("transition-opacity", pending && "opacity-60")}>
      <div className="flex items-center justify-between gap-3">
        <StepButton direction={-1} disabled={pending || !summary.has_previous} onStep={onStep} />
        <p aria-live="polite" className="text-sm font-bold tabular-nums text-ink">
          {rangeLabel(summary)}
        </p>
        <StepButton direction={1} disabled={pending || !summary.has_next} onStep={onStep} />
      </div>

      <section aria-label={rangeLabel(summary)} className="mt-4">
        {summary.attended === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-base text-ink">{emptyLine(summary)}</p>
            <BookClassLink />
          </div>
        ) : (
          <>
            <p className="text-ink">
              <span className="font-serif text-6xl leading-none tabular-nums text-accent">{count}</span>{" "}
              <span className="font-serif text-2xl">{label}</span>
            </p>
            {(comparison || breakdown) && (
              <p className="mt-2 text-sm text-muted">{[comparison, breakdown].filter(Boolean).join(" · ")}</p>
            )}
          </>
        )}
      </section>

      <div className={cn(CARD, "mt-5 px-3.5 pb-3 pt-4 sm:px-5")}>
        {summary.period === "week" ? (
          <PracticeWeek summary={summary} today={today} />
        ) : summary.period === "year" ? (
          <PracticeYear summary={summary} today={today} />
        ) : (
          <PracticeMonth summary={summary} today={today} />
        )}
      </div>

      {everAttended && (
        <dl className={cn(CARD, "mt-4 grid grid-cols-3 divide-x divide-ink/5")}>
          <Figure value={durationLabel(summary.minutes)} label="Time on the mat" />
          <Figure value={String(summary.streak_weeks)} label={streakLabel(isCurrent(summary))} />
          <Figure value={usualSlotLabel(summary.usual_slot)} label="Your usual" />
        </dl>
      )}

      {bars.length > 0 && (
        <section aria-labelledby="practised-heading" className="mt-6">
          <h2 id="practised-heading" className="mb-2.5 text-sm font-bold text-ink">
            What you practised
          </h2>
          <ul className="grid gap-2.5">
            {bars.map((b) => (
              <li key={b.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
                <span className="truncate text-ink">{b.name}</span>
                <span className="tabular-nums text-muted">{b.attended}</span>
                <span aria-hidden className="col-span-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${b.share * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {workshops && <p className="mt-5 border-t border-ink/10 pt-4 text-sm text-muted">{workshops}</p>}

      <Link href="/" className={cn(BTN_BOOK, "mt-6 w-full")}>
        <CalendarPlus className="h-4 w-4" aria-hidden />
        Book your next class
      </Link>
    </div>
  );
}

function StepButton({
  direction,
  disabled,
  onStep,
}: {
  direction: -1 | 1;
  disabled: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  const Icon = direction < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={() => onStep(direction)}
      disabled={disabled}
      aria-label={direction < 0 ? "Previous period" : "Next period"}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink/10 bg-card text-ink transition-colors hover:border-ink/25 disabled:cursor-default disabled:opacity-35 disabled:hover:border-ink/10"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse gap-0.5 px-3 py-3">
      <dt className="text-[11px] leading-tight text-muted">{label}</dt>
      <dd className="text-base font-extrabold tabular-nums leading-tight text-ink sm:text-lg">{value}</dd>
    </div>
  );
}

function BookClassLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-[44px] shrink-0 items-center gap-1 text-sm font-semibold text-accent-deep hover:text-accent"
    >
      Book a class
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}
