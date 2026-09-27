"use client";

/**
 * "Coming up" on the account overview: the one booking the member walks into
 * next — a class, a PT session or a workshop, whichever starts first — as the
 * ticket, with its QR and (where the member may still cancel) its Cancel.
 * Everything after it lives on its own page; this screen shows only what is
 * next.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Portal } from "@/components/ui/portal";
import { ContentLoading } from "@/components/ui/content-loading";
import {
  BTN_SECONDARY,
  CARD,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { NextTicketCard, classTicket, nextClass, type Ticket } from "@/components/account/next-class-card";
import { CancelBookingDialog, type CancelOutcome } from "@/components/account/cancel-booking-dialog";
import type { ApiBooking } from "@/components/account/class-bookings";
import type { ApiWorkshopBooking } from "@/components/account/workshop-bookings";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useClientPackages } from "@/lib/use-client-packages";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import {
  canCancelClass,
  canStillCancel,
  ptCancelPrompt,
  ptCancelResult,
} from "@/lib/cancellation-copy";
import { makePtSessionsApi, ptCancelFailure, type RawPtRequest } from "@/lib/pt-sessions";

/** The ticket, and what a Cancel on it acts on. */
type Next =
  | { ticket: Ticket; booking: ApiBooking }
  | { ticket: Ticket; pt: RawPtRequest }
  | { ticket: Ticket; workshop: ApiWorkshopBooking };

function ptTicket(r: RawPtRequest): Ticket {
  return {
    kind: "pt",
    name: `${r.session_type === "1on1" ? "1-on-1" : "2-on-1"} · ${r.class_name ?? "Private session"}`,
    starts_at: r.session!.starts_at,
    location: r.location_name ?? null,
    instructor: r.session!.instructor_name,
    qr_token: r.booking!.qr_token,
    code: r.booking!.code,
    attended: r.booking!.check_in_state === "attended",
  };
}

function workshopTicket(w: ApiWorkshopBooking): Ticket {
  return {
    kind: "workshop",
    name: w.workshop_name,
    starts_at: w.starts_at!,
    location: w.location?.name ?? null,
    instructor: null,
    qr_token: w.qr_token,
    code: w.code,
    attended: w.check_in_state === "attended",
  };
}

/**
 * The soonest of the three that has not yet ended. A running one starts
 * earliest, so it leads — the member arriving late still has a QR to show.
 */
export function nextUp(
  classes: { upcoming: ApiBooking[]; past: ApiBooking[] },
  pt: RawPtRequest[],
  workshops: ApiWorkshopBooking[],
  now: number,
): Next | null {
  const candidates: Next[] = [];
  const cls = nextClass(classes.upcoming, classes.past, now);
  if (cls) candidates.push({ ticket: classTicket(cls), booking: cls });
  for (const r of pt) {
    if (r.status === "scheduled" && r.session && r.booking && new Date(r.session.ends_at).getTime() > now) {
      candidates.push({ ticket: ptTicket(r), pt: r });
    }
  }
  // A workshop's `starts_at`/`ends_at` span its first day to its last, not a
  // day's session. Once it has begun it counts as running only for its first
  // day, so a workshop spread over weeks never holds the ticket over the
  // classes and sessions booked between its days.
  for (const w of workshops) {
    if (w.state === "cancelled" || !w.starts_at) continue;
    const start = new Date(w.starts_at).getTime();
    const end = Math.min(w.ends_at ? new Date(w.ends_at).getTime() : start, start + 24 * 60 * 60 * 1000);
    if (start > now || end > now) {
      candidates.push({ ticket: workshopTicket(w), workshop: w });
    }
  }
  candidates.sort((a, b) => a.ticket.starts_at.localeCompare(b.ticket.starts_at));
  return candidates[0] ?? null;
}

export function ComingUp() {
  const api = useApi();
  const policy = useCancellationPolicy();
  const { refetch: refetchPackages } = useClientPackages();
  const [loading, setLoading] = useState(true);
  const [next, setNext] = useState<Next | null>(null);
  const [cancelClass, setCancelClass] = useState<ApiBooking | null>(null);
  const [cancelPt, setCancelPt] = useState<RawPtRequest | null>(null);

  const reload = useCallback(async () => {
    try {
      // Only the class bookings are essential: a failed PT, workshop or past
      // read must not blank a confirmed class into "Nothing booked yet".
      const optional = <T,>(p: Promise<T>, fallback: T, scope: string) =>
        p.catch((err) => {
          reportError(err, { scope });
          return fallback;
        });
      const [upcoming, past, pt, workshops] = await Promise.all([
        api.get<{ bookings: ApiBooking[] }>("/me/bookings/upcoming"),
        optional(api.get<{ bookings: ApiBooking[] }>("/me/bookings/past"), { bookings: [] }, "coming-up-past"),
        optional(makePtSessionsApi(api).listRequests(), { pt_requests: [] }, "coming-up-pt"),
        optional(
          api.get<{ workshop_bookings: ApiWorkshopBooking[] }>("/me/workshop-bookings"),
          { workshop_bookings: [] },
          "coming-up-workshops",
        ),
      ]);
      setNext(
        nextUp(
          { upcoming: upcoming.bookings ?? [], past: past.bookings ?? [] },
          pt.pt_requests ?? [],
          workshops.workshop_bookings ?? [],
          Date.now(),
        ),
      );
    } catch (err) {
      reportError(err, { scope: "coming-up" });
      setNext(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onClassCancelled(outcome: CancelOutcome) {
    setCancelClass(null);
    const say = outcome.tone === "ok" ? toast.success : outcome.tone === "warn" ? toast.warning : toast.error;
    say(outcome.text);
    if (outcome.cancelled || outcome.stale) await reload();
  }

  async function onPtDone(result: { tone: "ok" | "warn" | "error"; text: string }) {
    setCancelPt(null);
    const say = result.tone === "ok" ? toast.success : result.tone === "warn" ? toast.warning : toast.error;
    say(result.text);
    await reload();
    await refetchPackages();
  }

  // Cancel is offered only where the server would take it: a class until it
  // starts; a PT session the member requested, outside the studio's window.
  // A workshop is never self-cancelled — the studio arranges that (#272).
  let onCancel: (() => void) | undefined;
  if (next && "booking" in next && canCancelClass(next.booking.starts_at)) {
    const b = next.booking;
    onCancel = () => setCancelClass(b);
  } else if (
    next &&
    "pt" in next &&
    next.pt.role !== "partner" &&
    policy &&
    canStillCancel(next.ticket.starts_at, policy.pt_window_hours)
  ) {
    const r = next.pt;
    onCancel = () => setCancelPt(r);
  }

  return (
    <section aria-labelledby="coming-up" className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="coming-up" className="text-base font-bold text-ink">
          Coming up
        </h2>
        {next && (
          <Link
            href="/account/classes"
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-accent-deep hover:text-accent"
          >
            Your classes
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {loading ? (
        <ContentLoading label="Loading what's coming up" className="min-h-32" />
      ) : !next ? (
        <div className={cn(CARD, "flex items-center justify-between gap-3 p-4")}>
          <p className="text-sm text-muted">Nothing booked yet.</p>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent-deep hover:text-accent"
          >
            Book a class
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <NextTicketCard ticket={next.ticket} className="mb-0" onCancel={onCancel} />
      )}

      {cancelClass && (
        <CancelBookingDialog
          booking={cancelClass}
          policy={policy}
          onDone={onClassCancelled}
          onClose={() => setCancelClass(null)}
        />
      )}

      {cancelPt && (
        <CancelPtDialog
          request={cancelPt}
          prompt={ptCancelPrompt("scheduled", policy)}
          windowHours={policy?.pt_window_hours ?? null}
          onDone={onPtDone}
          onClose={() => setCancelPt(null)}
        />
      )}
    </section>
  );
}

/** "Cancel this session?" — the PT cancel, asked before it is sent. */
function CancelPtDialog({
  request,
  prompt,
  windowHours,
  onDone,
  onClose,
}: {
  request: RawPtRequest;
  prompt: string;
  windowHours: number | null;
  onDone: (result: { tone: "ok" | "warn" | "error"; text: string }) => void;
  onClose: () => void;
}) {
  const api = useApi();
  const [cancelling, setCancelling] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  async function confirm() {
    setCancelling(true);
    try {
      const res = await makePtSessionsApi(api).cancelRequest(request.id);
      onDone(ptCancelResult(res.refundOutcome, res.refundedSessions));
    } catch (err) {
      onDone({ tone: "error", text: ptCancelFailure(err, windowHours) });
    }
  }

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={() => !cancelling && onClose()}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-pt-title"
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && !cancelling && onClose()}
        >
          <span aria-hidden className={SHEET_HANDLE} />
          <h3 id="cancel-pt-title" className={SHEET_TITLE}>
            Cancel this session?
          </h3>
          <p className={SHEET_TEXT}>{prompt}</p>
          <div className={SHEET_ACTIONS}>
            <button type="button" onClick={onClose} disabled={cancelling} className={BTN_SECONDARY}>
              Keep session
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={cancelling}
              className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full bg-error px-4 text-sm font-semibold text-inverse hover:bg-error/90 transition-colors disabled:opacity-70 disabled:cursor-wait"
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              {cancelling ? "Cancelling…" : "Confirm cancellation"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
