"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, CalendarX, X } from "lucide-react";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { WaitlistCard, type ApiBooking } from "@/components/account/class-bookings";
import { BookingRow } from "@/components/account/booking-cards";
import { BookedClassOverlay } from "@/components/account/booked-class-overlay";
import { CancelBookingDialog, type CancelOutcome } from "@/components/account/cancel-booking-dialog";
import { LeaveWaitlistDialog } from "@/components/booking/leave-waitlist-dialog";
import { SubTabs } from "@/components/ui/sub-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { ContentLoading } from "@/components/ui/content-loading";
import { BTN_BOOK, BTN_SECONDARY, CARD } from "@/components/ui/styles";
import { ApiError, apiErrorCode as errCode, useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import { readBookingSources } from "@/lib/booking-sources";
import { leaveWaitlist, listWaitlist, waitlistRefusal, type ApiWaitlistEntry } from "@/lib/waitlist";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import { ptCancelResult, ptPolicyNote } from "@/lib/cancellation-copy";
import { useClientPackages } from "@/lib/use-client-packages";
import {
  bookingItems,
  sortForPhase,
  type BookingPhase,
  type BookingSources,
  type BookingType,
} from "@/lib/my-bookings";

type TypeFilter = "all" | BookingType;

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "class", label: "Classes" },
  { value: "pt", label: "Private" },
  { value: "workshop", label: "Workshops" },
  { value: "corporate", label: "Corporate" },
];

const PHASES: { value: BookingPhase; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "ongoing", label: "Ongoing" },
  { value: "past", label: "Past" },
];

const isType = (v: string | null): v is TypeFilter => TYPE_OPTIONS.some((o) => o.value === v);
const isPhase = (v: string | null): v is BookingPhase => PHASES.some((o) => o.value === v);

/** What a request just sent is told, on arrival from its form. */
const SUBMITTED: Record<string, string> = {
  pt: "Your request is in. We'll reach you on WhatsApp shortly to confirm the time.",
  corporate: "Your request is in. We'll arrange the date, place and instructor with you on WhatsApp.",
};

type Banner = { tone: "ok" | "warn" | "error"; text: string };

export default function YourBookingsPage() {
  return (
    <Suspense fallback={<ContentLoading label="Loading your bookings" />}>
      <YourBookings />
    </Suspense>
  );
}

/**
 * "Your bookings": every class, PT session or request, workshop and corporate
 * request the member holds, in one list — filtered by kind, and by Upcoming,
 * Ongoing or Past (`lib/my-bookings.ts`). The next one's ticket is on `/account`.
 * `?type=` and `?when=` open it filtered; the old per-kind pages redirect here.
 */
function YourBookings() {
  const params = useSearchParams();
  const api = useApi();
  const policy = useCancellationPolicy();
  const { refetch: refetchPackages } = useClientPackages();

  const [type, setType] = useState<TypeFilter>(() => {
    const t = params.get("type");
    return isType(t) ? t : "all";
  });
  const [phase, setPhase] = useState<BookingPhase>(() => {
    const w = params.get("when");
    return isPhase(w) ? w : "upcoming";
  });
  const submitted = SUBMITTED[params.get("submitted") ?? ""] ?? null;

  const [src, setSrc] = useState<BookingSources | null>(null);
  const [waitlisted, setWaitlisted] = useState<ApiWaitlistEntry[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ApiBooking | null>(null);
  const [opened, setOpened] = useState<{ booking: ApiBooking; ongoing: boolean } | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<ApiWaitlistEntry | null>(null);
  const [leaving, setLeaving] = useState(false);

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      // A failed waitlist read, like the other optional lists
      // (`readBookingSources`), must not blank the member's classes.
      const [sources, waitlist] = await Promise.all([
        readBookingSources(api),
        listWaitlist(api).catch((err) => {
          reportError(err, { scope: "bookings-waitlist" });
          return [] as ApiWaitlistEntry[];
        }),
      ]);
      setSrc(sources);
      setWaitlisted(waitlist);
    } catch (err) {
      reportError(err, { scope: "bookings" });
      setLoadError(true);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  const items = useMemo(() => (src ? bookingItems(src, Date.now()) : []), [src]);
  const ofType = useMemo(
    () => items.filter((i) => type === "all" || i.type === type),
    [items, type],
  );
  const counts = useMemo(() => {
    const c: Record<BookingPhase, number> = { upcoming: 0, ongoing: 0, past: 0 };
    for (const i of ofType) c[i.phase] += 1;
    return c;
  }, [ofType]);
  const rows = useMemo(() => sortForPhase(ofType.filter((i) => i.phase === phase), phase), [ofType, phase]);
  const showWaitlist = phase === "upcoming" && (type === "all" || type === "class") && waitlisted.length > 0;

  const changed = reload;

  async function onClassCancelled(outcome: CancelOutcome) {
    setCancelTarget(null);
    setBanner({ tone: outcome.tone, text: outcome.text });
    if (outcome.cancelled || outcome.stale) await changed();
  }

  async function confirmLeave() {
    if (!leaveTarget) return;
    setLeaving(true);
    try {
      await leaveWaitlist(api, leaveTarget.id);
      setBanner({ tone: "ok", text: "Left the waitlist." });
    } catch (err) {
      const out = waitlistRefusal(errCode(err), err instanceof ApiError ? err.body : null);
      setBanner({
        tone: "error",
        text: out?.kind === "message" ? out.msg : "Couldn't leave the waitlist. Please try again.",
      });
    } finally {
      // Everyone behind the member moves up, so positions are re-read, not guessed.
      await reload();
      setLeaving(false);
      setLeaveTarget(null);
    }
  }

  return (
    <div>
      <AccountPageHeader
        title="My bookings"
        action={
          <Link href="/" className={cn(BTN_BOOK, "hidden sm:inline-flex min-h-[44px]")}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Book a class
          </Link>
        }
      />

      {submitted && (
        <div role="status" className="mb-5 rounded-xl border border-sage/30 bg-sage/10 px-4 py-3 text-sm text-ink">
          {submitted}
        </div>
      )}

      {banner && (
        <div
          role="status"
          className={cn(
            "mb-4 flex items-start justify-between gap-3 rounded-xl border p-3 text-sm text-ink",
            banner.tone === "ok" && "border-sage/25 bg-sage/10",
            banner.tone === "warn" && "border-warning/30 bg-warning/10",
            banner.tone === "error" && "border-error/25 bg-error/10",
          )}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
            className="shrink-0 text-muted hover:text-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* As the packages page reads: when first, as pills, then which kind, as words on a hairline. */}
      <SegmentedTabs
        label="When"
        tabs={PHASES}
        value={phase}
        onChange={setPhase}
        counts={src ? counts : undefined}
        centered
      />
      <SubTabs label="Booking type" tabs={TYPE_OPTIONS} value={type} onChange={setType} centered className="mb-4" />

      {!src && !loadError ? (
        <ContentLoading label="Loading your bookings" />
      ) : loadError ? (
        <div className={cn(CARD, "p-8 text-center")}>
          <p className="text-sm text-muted">Couldn&apos;t load your bookings.</p>
          <button type="button" onClick={reload} className={cn(BTN_SECONDARY, "mt-4 min-h-[44px]")}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {showWaitlist && (
            <section aria-labelledby="waitlisted-heading" className="mb-5">
              <h3 id="waitlisted-heading" className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                Waitlisted
              </h3>
              <div className="space-y-3">
                {waitlisted.map((e) => (
                  <WaitlistCard key={e.id} entry={e} onLeave={setLeaveTarget} />
                ))}
              </div>
            </section>
          )}

          {rows.length === 0 ? (
            showWaitlist ? null : (
              <div className={CARD}>
                <EmptyState icon={CalendarX} {...emptyCopy(type, phase)} />
              </div>
            )
          ) : (
            <ul className="space-y-3">
              {rows.map((i) => (
                <BookingRow
                  key={i.key}
                  item={i}
                  policy={policy}
                  onCancelClass={setCancelTarget}
                  onOpenClass={(booking, ongoing) => setOpened({ booking, ongoing })}
                  onPtCancelled={async (result) => {
                    const r = ptCancelResult(result.refundOutcome, result.refundedSessions);
                    setBanner({ tone: r.tone, text: r.text });
                    await changed();
                    await refetchPackages();
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {(type === "pt" || type === "all") && src && src.pt.length > 0 && (
        <p className="mt-8 text-xs leading-relaxed text-muted">{ptPolicyNote(policy)}</p>
      )}

      {opened && (
        <BookedClassOverlay
          booking={opened.booking}
          ongoing={opened.ongoing}
          onCancel={(b) => {
            setOpened(null);
            setCancelTarget(b);
          }}
          onClose={() => setOpened(null)}
        />
      )}

      {cancelTarget && (
        <CancelBookingDialog
          booking={cancelTarget}
          policy={policy}
          onDone={onClassCancelled}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {leaveTarget && (
        <LeaveWaitlistDialog
          classTitle={leaveTarget.name}
          startsAt={leaveTarget.starts_at}
          position={leaveTarget.position}
          leaving={leaving}
          onConfirm={confirmLeave}
          onClose={() => setLeaveTarget(null)}
        />
      )}
    </div>
  );
}

/** An empty list is a way in: to the page where that kind is booked. */
function emptyCopy(type: TypeFilter, phase: BookingPhase) {
  const noun = {
    all: "bookings",
    class: "classes",
    pt: "private sessions",
    workshop: "workshops",
    corporate: "corporate requests",
  }[type];
  const title =
    phase === "upcoming" ? `No upcoming ${noun}` : phase === "ongoing" ? `No ${noun} in progress` : `No past ${noun}`;
  const cta =
    type === "pt"
      ? { href: "/private-sessions", label: "Request a session" }
      : type === "workshop"
        ? { href: "/workshops", label: "Browse workshops" }
        : type === "corporate"
          ? { href: "/packages#corporate", label: "See corporate packages" }
          : { href: "/", label: "See the schedule" };
  return phase === "upcoming" ? { title, cta } : { title };
}
