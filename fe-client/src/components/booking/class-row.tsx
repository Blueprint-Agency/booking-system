"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, UserRound, MapPin, Loader2, Lock } from "lucide-react";
import { cn, formatSgd } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Portal } from "@/components/ui/portal";
import { ApiError, apiErrorCode as errCode, useApi } from "@/lib/api";
import { notCoveredCopy, planRunsOutCopy } from "@/lib/booking-copy";
import { ERROR_CODES } from "@/lib/error-codes";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { formatClassTime, type ApiClassCard, type ClassEntitlements } from "@/lib/classes";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import {
  classAction,
  joinedToast,
  joinWaitlist,
  leaveWaitlist,
  waitlistRefusal,
  type WaitlistPlace,
} from "@/lib/waitlist";
import { toast } from "sonner";
import { LeaveWaitlistDialog } from "@/components/booking/leave-waitlist-dialog";
import { ConfirmBookingSheet } from "@/components/booking/confirm-booking-sheet";

const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

export function ClassRow({
  cls,
  showLocation,
  canBook,
  canBookLoaded,
  isSignedIn,
  entitlements,
  onStale,
}: {
  cls: ApiClassCard;
  showLocation: boolean;
  canBook: boolean;
  canBookLoaded: boolean;
  isSignedIn: boolean;
  entitlements: ClassEntitlements | null;
  /** Re-read the feed: the row's state turned out to be out of date. */
  onStale?: () => void;
}) {
  const router = useRouter();
  const api = useApi();
  const [showNoPackage, setShowNoPackage] = useState(false);
  // One state, so the message and its offer can't drift apart. `offersCredit` is
  // set only on the expiry refusal, where credits are the one way through (§3).
  // `title` is set by a waitlist refusal; unset reads "Couldn't book".
  const [bookError, setBookError] = useState<
    { msg: string; offersCredit?: boolean; title?: string } | null
  >(null);
  const [booked, setBooked] = useState(cls.is_booked ?? false);
  const [spotsLeft, setSpotsLeft] = useState(cls.spots_left);
  const [booking, setBooking] = useState(false);
  // The confirmation open, and whether the member chose to pay with credits.
  const [confirmBook, setConfirmBook] = useState<{ useCredits: boolean } | null>(null);
  const [myEntry, setMyEntry] = useState<WaitlistPlace | null>(cls.waitlist.my_entry);
  const [waitlistOpen, setWaitlistOpen] = useState(cls.waitlist.open);
  const [joining, setJoining] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // A re-read feed hands the row a new card: take what the server now says,
  // rather than what this row last believed.
  const [seenCls, setSeenCls] = useState(cls);
  if (cls !== seenCls) {
    setSeenCls(cls);
    setBooked(cls.is_booked ?? false);
    setSpotsLeft(cls.spots_left);
    setMyEntry(cls.waitlist.my_entry);
    setWaitlistOpen(cls.waitlist.open);
  }
  const noPackageTrapRef = useFocusTrap<HTMLDivElement>(showNoPackage);
  const bookErrorTrapRef = useFocusTrap<HTMLDivElement>(Boolean(bookError));
  useBodyScrollLock(showNoPackage || Boolean(bookError));
  const isFull = spotsLeft <= 0;
  const locationName = cls.location?.name ?? null;

  // The member's plan covers one studio; this class is at the other one (§2).
  // Shown rather than hidden, and quietly — this state repeats on every class at
  // the other studio, and at that density a louder offer reads as an ad break.
  const planLocation = entitlements?.unlimited_location ?? null;
  // A commented mirror of `covers()` in be/src/services/packages/selection.ts —
  // a plan carrying the Add-On Covers both Locations, so nothing is blocked and
  // there is nothing left to sell. The server refusal stays the enforcement.
  const notCovered =
    !booked &&
    !!planLocation &&
    !entitlements?.unlimited_covers_both &&
    !!cls.location &&
    cls.location.id !== planLocation.id;
  const hasCredits = !!entitlements?.has_active_bundle_credits;
  // Credits can only step in while nothing in the class family is running: a
  // running plan is the only package that can pay, and the credits behind it
  // cannot start until it ends (§3). The backend refuses either way.
  const creditsCanStart = hasCredits && !entitlements?.class_family_running;
  const canUseCredit = notCovered && creditsCanStart;
  // The upsell: the Add-On on the plan that would pay, at the rate the server states.
  const addOn =
    notCovered && entitlements?.unlimited_plan_id && cls.location
      ? {
          href: `/checkout?add_on=${entitlements.unlimited_plan_id}`,
          label: `Add ${cls.location.name} for ${formatSgd(entitlements.cross_location_rate_sgd)}/month`,
        }
      : null;

  /** A tap on Book: the checks that need no server, then the confirmation. */
  const requestBook = (e: React.MouseEvent, useCredits = false) => {
    e.preventDefault();
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent("/")}`);
      return;
    }
    if (canBookLoaded && !canBook) {
      setShowNoPackage(true);
      return;
    }
    if (booking || booked) return;
    setConfirmBook({ useCredits });
  };

  const handleBookClick = async (e: React.MouseEvent | null, useCredits = false) => {
    e?.preventDefault();
    if (booking || booked) return;
    setBooking(true);
    try {
      await api.post("/me/bookings/class", {
        class_id: cls.id,
        ...(useCredits ? { use_credits: true } : {}),
      });
      setBookError(null);
      setBooked(true);
      setSpotsLeft((s) => Math.max(0, s - 1));
    } catch (err) {
      const code = errCode(err);
      if (code === ERROR_CODES.insufficient_credits) {
        setBookError(null);
        setShowNoPackage(true);
      } else if (code === ERROR_CODES.already_booked) {
        setBookError(null);
        setBooked(true);
      } else if (code === ERROR_CODES.class_full) {
        setSpotsLeft(0);
        // The refusal says whether the line is open, so the row can offer it.
        const open =
          err instanceof ApiError && err.body && typeof err.body === "object"
            ? (err.body as { waitlist_open?: unknown }).waitlist_open === true
            : false;
        setWaitlistOpen(open);
        setBookError({
          msg: open ? "This class just filled up. You can join the waitlist instead." : "This class just filled up.",
        });
      } else if (code === ERROR_CODES.class_already_started) {
        setBookError({ msg: "This class has already started." });
      } else if (code === ERROR_CODES.location_not_covered) {
        // Genuinely the wrong studio. The lock chip below catches this before
        // the click in the normal case; what lands here is entitlements the
        // client read too early or too late.
        setBookError({ msg: notCoveredCopy(planLocation?.name ?? null) });
      } else if (code === ERROR_CODES.plan_expires_before_class) {
        // Not a coverage problem: the package does cover this studio, it just
        // runs out first. The Cross-Location Add-On sells Locations, not time,
        // so it is the wrong remedy here — and the next package starts itself
        // on the first booking after the current one ends. Credits are offered
        // only when nothing is running yet (a Dormant plan being passed over):
        // while a package runs, nothing behind it can start.
        setBookError({ msg: planRunsOutCopy(creditsCanStart), offersCredit: creditsCanStart });
      } else {
        setBookError({ msg: "Couldn't book this class. Please try again." });
      }
    } finally {
      setBooking(false);
      setConfirmBook(null);
    }
  };

  /** A refused join or leave, told the way §9 words it; an unknown code gets the generic dialog. */
  const handleWaitlistRefusal = (err: unknown, title: string) => {
    const body = err instanceof ApiError ? err.body : null;
    const out = waitlistRefusal(errCode(err), body, planLocation?.name ?? null);
    if (!out) {
      setBookError({ title, msg: "Something went wrong. Please try again." });
    } else if (out.kind === "no_package") {
      setShowNoPackage(true);
    } else if (out.kind === "refresh") {
      onStale?.();
    } else {
      if (out.closed) setWaitlistOpen(false);
      if (out.refresh) onStale?.();
      setBookError({ title, msg: out.msg });
    }
  };

  const handleJoinClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent("/")}`);
      return;
    }
    if (canBookLoaded && !canBook) {
      setShowNoPackage(true);
      return;
    }
    if (joining || myEntry) return;
    setJoining(true);
    try {
      const res = await joinWaitlist(api, cls.id);
      setBookError(null);
      setMyEntry({ id: res.entry_id, position: res.position });
      toast.success(joinedToast(res.position));
    } catch (err) {
      handleWaitlistRefusal(err, "Couldn't join the waitlist");
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!myEntry || leaving) return;
    setLeaving(true);
    try {
      await leaveWaitlist(api, myEntry.id);
      setMyEntry(null);
      toast.success("Left the waitlist.");
      // Whether the line is still open (and so whether the row reads "Join
      // waitlist" or "Full") is the server's to say.
      onStale?.();
    } catch (err) {
      handleWaitlistRefusal(err, "Couldn't leave the waitlist");
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  };

  const action = classAction({ booked, myEntry, spotsLeft, waitlistOpen, notCovered });
  // Dimmed only when there is nothing to do here; a full class with a line to
  // join, or the member's own place in it, stays at full strength.
  const dim = action === "full" || action === "not_covered";

  // The time moves into the text block on a phone, so the name, its meta and
  // a compact action all fit on one row at 320px without truncating the name.
  const shape =
    "inline-flex min-h-[40px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold";
  const cta =
    action === "booked" ? (
      <span className={cn(shape, "bg-sage/15 text-sage")}>
        <Check className="h-4 w-4" aria-hidden />
        Booked
      </span>
    ) : action === "waitlisted" && myEntry ? (
      <span className="inline-flex items-center gap-1">
        <span className={cn(shape, "bg-warning/15 text-ink")}>On waitlist · #{myEntry.position}</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            setConfirmLeave(true);
          }}
          disabled={leaving}
          className="min-h-[40px] px-2 text-xs font-medium text-muted underline underline-offset-2 hover:text-error transition-colors disabled:cursor-wait"
        >
          Leave
        </button>
      </span>
    ) : action === "join_waitlist" ? (
      <button
        onClick={handleJoinClick}
        disabled={joining}
        className={cn(
          shape,
          "border border-warning bg-warning/10 text-ink hover:bg-warning/20 transition-colors disabled:opacity-70 disabled:cursor-wait",
        )}
      >
        {joining && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {joining ? "Joining…" : "Join waitlist"}
      </button>
    ) : action === "full" ? (
      <span className={cn(shape, "bg-ink/5 text-muted")}>Full</span>
    ) : action === "not_covered" ? (
      <span className={cn(shape, "bg-ink/5 text-muted")}>
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Not in plan
      </span>
    ) : (
      <button
        onClick={(e) => requestBook(e)}
        disabled={booking}
        className={cn(
          shape,
          "bg-ink text-paper hover:bg-ink/90 transition-colors disabled:opacity-70 disabled:cursor-wait",
        )}
      >
        {booking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {booking ? "Booking…" : "Book Now"}
      </button>
    );
  const timeRange = `${formatClassTime(cls.starts_at)} – ${formatClassTime(cls.ends_at)}`;

  return (
    <div className="px-4 py-3.5 md:px-5 md:py-4">
      {/* Dim the row only — not the plan nudge below, which is the way
          through, nor a dialog opened from this row. A full class with a line
          to join, or the member's own place in it, stays at full strength. */}
      <div className={cn("flex items-center gap-3 md:gap-5", dim && "opacity-60")}>
        {/* Time — its own column once there is room */}
        <div className="hidden sm:block w-[76px] shrink-0 tabular-nums">
          <div className="text-[15px] font-bold tracking-tight text-ink">
            {formatClassTime(cls.starts_at)}
          </div>
          <div className="text-xs text-muted">{formatClassTime(cls.ends_at)}</div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="sm:hidden text-xs font-semibold text-ink/70 tabular-nums">{timeRange}</p>
          <h3 className="font-semibold text-ink leading-snug break-words">
            {cls.class_type.name}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-ink/30" />
              <span className="truncate">{cls.instructor.name}</span>
            </span>
            {showLocation && locationName && (
              <>
                <span aria-hidden className="text-ink/20">·</span>
                <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ink/30" />
                  <span className="truncate">{locationName}</span>
                </span>
              </>
            )}
            {!isFull && !booked && spotsLeft <= 3 && (
              <>
                <span aria-hidden className="text-ink/20">·</span>
                <span className="font-medium text-accent-deep">
                  {spotsLeft} left
                </span>
              </>
            )}
            <span aria-hidden className="text-ink/20">·</span>
            <span className="tabular-nums">{credits(cls.credit_cost)}</span>
          </div>
        </div>

        <div className="shrink-0">{cta}</div>
      </div>

      {notCovered && planLocation && (
        <div className="mt-2.5 rounded-lg bg-ink/[0.03] px-3 py-2 text-xs text-muted">
          Your plan covers <span className="font-medium text-ink">{planLocation.name}</span> only.
          {addOn && (
            <>
              <span aria-hidden className="text-ink/20"> · </span>
              <Link
                href={addOn.href}
                className="underline underline-offset-2 hover:text-ink transition-colors"
              >
                {addOn.label}
              </Link>
            </>
          )}
          {canUseCredit && (
            <>
              <span aria-hidden className="text-ink/20"> · </span>
              {addOn && "or "}
              <button
                onClick={(e) => requestBook(e, true)}
                disabled={booking}
                className="underline underline-offset-2 hover:text-ink transition-colors disabled:cursor-wait"
              >
                {booking ? "Booking…" : `use ${credits(cls.credit_cost)}`}
              </button>
            </>
          )}
        </div>
      )}

      {confirmBook && (
        <ConfirmBookingSheet
          cls={cls}
          cost={
            // An Unlimited plan pays for a class at a studio it covers; credits
            // pay otherwise, and whenever the member chose them.
            planLocation && !notCovered && !confirmBook.useCredits
              ? "Covered by your Unlimited plan"
              : `Uses ${credits(cls.credit_cost)}`
          }
          booking={booking}
          onConfirm={() => handleBookClick(null, confirmBook.useCredits)}
          onClose={() => setConfirmBook(null)}
        />
      )}

      {confirmLeave && myEntry && (
        <LeaveWaitlistDialog
          classTitle={cls.class_type.name}
          startsAt={cls.starts_at}
          position={myEntry.position}
          leaving={leaving}
          onConfirm={handleLeave}
          onClose={() => setConfirmLeave(false)}
        />
      )}

      {showNoPackage && (
        <Portal>
        <div className={SHEET_BACKDROP} onClick={() => setShowNoPackage(false)}>
          <div ref={noPackageTrapRef} role="dialog" aria-modal="true" aria-labelledby={`no-package-${cls.id}`} tabIndex={-1} className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
            <span aria-hidden className={SHEET_HANDLE} />
            <h3 id={`no-package-${cls.id}`} className={SHEET_TITLE}>You&apos;re out of credits</h3>
            <p className={SHEET_TEXT}>Buy a package to book this class.</p>
            <div className={SHEET_ACTIONS}>
              <button onClick={() => setShowNoPackage(false)} className={BTN_SECONDARY}>Not now</button>
              <button onClick={() => router.push("/packages")} className={BTN_PRIMARY}>See packages</button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {bookError && (
        <Portal>
        <div className={SHEET_BACKDROP} onClick={() => setBookError(null)}>
          <div ref={bookErrorTrapRef} role="dialog" aria-modal="true" aria-labelledby={`book-error-${cls.id}`} tabIndex={-1} className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
            <span aria-hidden className={SHEET_HANDLE} />
            {/* A waitlist refusal names itself; unset reads "Couldn't book". */}
            <h3 id={`book-error-${cls.id}`} className={SHEET_TITLE}>{bookError.title ?? "Couldn't book"}</h3>
            <p className={SHEET_TEXT}>{bookError.msg}</p>
            <div className={SHEET_ACTIONS}>
              <button onClick={() => setBookError(null)} className={BTN_SECONDARY}>
                {bookError.offersCredit ? "Not now" : "OK"}
              </button>
              {/* Only the expiry refusal offers credits here — the wrong-studio case
                  keeps its offer in the row nudge, per stories 25-27. */}
              {bookError.offersCredit && (
                <button
                  onClick={(e) => handleBookClick(e, true)}
                  disabled={booking}
                  className={BTN_PRIMARY}
                >
                  {booking && <Loader2 className="h-4 w-4 animate-spin" />}
                  {booking ? "Booking…" : `Use ${credits(cls.credit_cost)}`}
                </button>
              )}
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

type FilterSelectProps = {
  /** What the filter narrows by, for screen readers — the placeholder is the visible label. */
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
};

export function FilterSelect({ label, value, onChange, options, placeholder }: FilterSelectProps) {
  return (
    <Select
      ariaLabel={label ?? placeholder}
      value={value}
      onChange={onChange}
      options={[{ value: "", label: placeholder }, ...options]}
      className="min-w-0 flex-1 sm:max-w-[240px]"
      triggerClassName={value ? "border-accent/40 font-medium" : undefined}
    />
  );
}
