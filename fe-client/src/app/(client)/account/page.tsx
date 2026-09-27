"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, CalendarX, X } from "lucide-react";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { ComingUp } from "@/components/account/coming-up";
import { OpenPurchases } from "@/components/account/open-purchases";
import { WaitlistCard, type ApiBooking } from "@/components/account/class-bookings";
import type { ApiWorkshopBooking } from "@/components/account/workshop-bookings";
import {
  ClassBookingCard,
  CorporateBookingCard,
  PtBookingCard,
  WorkshopBookingCard,
} from "@/components/account/booking-cards";
import { CancelBookingDialog, type CancelOutcome } from "@/components/account/cancel-booking-dialog";
import { LeaveWaitlistDialog } from "@/components/booking/leave-waitlist-dialog";
import { CancelledBanner } from "@/components/checkout/cancelled-banner";
import { FilterChips } from "@/components/ui/filter-chips";
import { EmptyState } from "@/components/ui/empty-state";
import { ContentLoading } from "@/components/ui/content-loading";
import { BTN_BOOK, BTN_SECONDARY, CARD } from "@/components/ui/styles";
import { ApiError, apiErrorCode as errCode, useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import { makePtSessionsApi, type RawPtRequest } from "@/lib/pt-sessions";
import type { ApiCorporateRequest } from "@/lib/corporate";
import { leaveWaitlist, listWaitlist, waitlistRefusal, type ApiWaitlistEntry } from "@/lib/waitlist";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import { ptCancelResult, ptPolicyNote } from "@/lib/cancellation-copy";
import { useClientPackages } from "@/lib/use-client-packages";
import { usePartPaymentOptions, useOpenPurchases } from "@/lib/open-purchases";
import {
  bookingItems,
  sortForPhase,
  type BookingItem,
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
 * Ongoing or Past (`lib/my-bookings.ts`). The next one leads as the ticket.
 * `?type=` and `?when=` open it filtered; the old per-kind pages redirect here.
 */
function YourBookings() {
  const params = useSearchParams();
  const api = useApi();
  const policy = useCancellationPolicy();
  const { refetch: refetchPackages } = useClientPackages();
  const { purchases: openPurchases, failed: openPurchasesFailed } = useOpenPurchases();
  const partPayment = usePartPaymentOptions();

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
  const [leaveTarget, setLeaveTarget] = useState<ApiWaitlistEntry | null>(null);
  const [leaving, setLeaving] = useState(false);
  // The ticket above the list: what it shows is left out of the list, and a
  // change in either re-reads the other.
  const [ticketKey, setTicketKey] = useState<string | null>(null);
  const [ticketRefresh, setTicketRefresh] = useState(0);

  const reload = useCallback(async () => {
    setLoadError(false);
    // Only the class lists are essential: a failed PT, workshop, corporate or
    // waitlist read must not blank the member's classes.
    const optional = <T,>(p: Promise<T>, fallback: T, scope: string) =>
      p.catch((err) => {
        reportError(err, { scope });
        return fallback;
      });
    try {
      const [upcoming, past, pt, workshops, corporate, waitlist] = await Promise.all([
        api.get<{ bookings: ApiBooking[] }>("/me/bookings/upcoming"),
        api.get<{ bookings: ApiBooking[] }>("/me/bookings/past"),
        optional(makePtSessionsApi(api).listRequests(), { pt_requests: [] as RawPtRequest[] }, "bookings-pt"),
        optional(
          api.get<{ workshop_bookings: ApiWorkshopBooking[] }>("/me/workshop-bookings"),
          { workshop_bookings: [] },
          "bookings-workshops",
        ),
        optional(
          api.get<{ corporate_requests: ApiCorporateRequest[] }>("/me/corporate-requests"),
          { corporate_requests: [] },
          "bookings-corporate",
        ),
        optional(listWaitlist(api), [] as ApiWaitlistEntry[], "bookings-waitlist"),
      ]);
      setSrc({
        upcoming: upcoming.bookings ?? [],
        past: past.bookings ?? [],
        pt: pt.pt_requests ?? [],
        workshops: workshops.workshop_bookings ?? [],
        corporate: corporate.corporate_requests ?? [],
      });
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
    () => items.filter((i) => (type === "all" || i.type === type) && i.key !== ticketKey),
    [items, type, ticketKey],
  );
  const counts = useMemo(() => {
    const c: Record<BookingPhase, number> = { upcoming: 0, ongoing: 0, past: 0 };
    for (const i of ofType) c[i.phase] += 1;
    return c;
  }, [ofType]);
  const rows = useMemo(() => sortForPhase(ofType.filter((i) => i.phase === phase), phase), [ofType, phase]);
  const showWaitlist = phase === "upcoming" && (type === "all" || type === "class") && waitlisted.length > 0;

  const changed = async () => {
    await reload();
    setTicketRefresh((n) => n + 1);
  };

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
        title="Your bookings"
        action={
          <Link href="/" className={cn(BTN_BOOK, "hidden sm:inline-flex min-h-[44px]")}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Book a class
          </Link>
        }
      />

      {/* Back from a payment page the member left (#274). */}
      <CancelledBanner className="mb-5" />
      {submitted && (
        <div role="status" className="mb-5 rounded-xl border border-sage/30 bg-sage/10 px-4 py-3 text-sm text-ink">
          {submitted}
        </div>
      )}

      {/* Money paid that has granted nothing yet — the one thing here waiting on the member. */}
      <div className="mb-6 empty:hidden [&>*:first-child]:mt-0">
        <OpenPurchases purchases={openPurchases} partPayment={partPayment} failed={openPurchasesFailed} />
      </div>

      <ComingUp refreshKey={ticketRefresh} onChanged={reload} onResolved={setTicketKey} />

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

      <h2 className="mb-3 text-base font-bold text-ink">All bookings</h2>
      <FilterChips label="Booking type" options={TYPE_OPTIONS} value={type} onChange={setType} className="mb-3" />
      <SegmentedTabs label="When" tabs={PHASES} value={phase} onChange={setPhase} counts={src ? counts : undefined} />

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

function BookingRow({
  item,
  policy,
  onCancelClass,
  onPtCancelled,
}: {
  item: BookingItem;
  policy: ReturnType<typeof useCancellationPolicy>;
  onCancelClass: (b: ApiBooking) => void;
  onPtCancelled: Parameters<typeof PtBookingCard>[0]["onCancelled"];
}) {
  switch (item.type) {
    case "class":
      return <ClassBookingCard booking={item.booking} ongoing={item.phase === "ongoing"} onCancel={onCancelClass} />;
    case "pt":
      return <PtBookingCard request={item.request} policy={policy} onCancelled={onPtCancelled} />;
    case "workshop":
      return <WorkshopBookingCard booking={item.booking} phase={item.phase} />;
    case "corporate":
      return <CorporateBookingCard request={item.request} />;
  }
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
