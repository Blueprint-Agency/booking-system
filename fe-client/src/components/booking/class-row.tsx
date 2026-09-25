"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, UserRound, MapPin, Ticket, Loader2, Lock } from "lucide-react";
import { cn, formatSgd } from "@/lib/utils";
import { ApiError, useApi } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { formatClassTime, type ApiClassCard, type ClassEntitlements } from "@/lib/classes";

// A bottom sheet on phones — the actions land under the thumb, above the
// home indicator — and a centred dialog from `sm` up.
const SHEET_BACKDROP =
  "fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-4";
const SHEET_PANEL =
  "w-full max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-card px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center shadow-modal outline-none sm:max-w-sm sm:rounded-2xl sm:p-8 animate-fade-up";

export function ClassRow({
  cls,
  showLocation,
  canBook,
  canBookLoaded,
  isSignedIn,
  entitlements,
}: {
  cls: ApiClassCard;
  showLocation: boolean;
  canBook: boolean;
  canBookLoaded: boolean;
  isSignedIn: boolean;
  entitlements: ClassEntitlements | null;
}) {
  const router = useRouter();
  const api = useApi();
  const [showNoPackage, setShowNoPackage] = useState(false);
  // One state, so the message and its offer can't drift apart. `offersCredit` is
  // set only on the expiry refusal, where credits are the one way through (§3).
  const [bookError, setBookError] = useState<
    { msg: string; offersCredit?: boolean } | null
  >(null);
  const [booked, setBooked] = useState(cls.is_booked ?? false);
  const [spotsLeft, setSpotsLeft] = useState(cls.spots_left);
  const [booking, setBooking] = useState(false);
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

  const handleBookClick = async (e: React.MouseEvent, useCredits = false) => {
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
      const code =
        err instanceof ApiError &&
        err.body &&
        typeof err.body === "object" &&
        "error" in err.body
          ? String((err.body as { error: unknown }).error)
          : "";
      if (code === ERROR_CODES.insufficient_credits) {
        setBookError(null);
        setShowNoPackage(true);
      } else if (code === ERROR_CODES.already_booked) {
        setBookError(null);
        setBooked(true);
      } else if (code === ERROR_CODES.class_full) {
        setSpotsLeft(0);
        setBookError({ msg: "Sorry, this class just filled up." });
      } else if (code === ERROR_CODES.class_already_started) {
        setBookError({ msg: "This class has already started." });
      } else if (code === ERROR_CODES.location_not_covered) {
        // Genuinely the wrong studio. The lock chip below catches this before
        // the click in the normal case; what lands here is entitlements the
        // client read too early or too late.
        setBookError({
          msg: planLocation
            ? `Your plan covers ${planLocation.name} only.`
            : "Your plan doesn't cover this studio.",
        });
      } else if (code === ERROR_CODES.plan_expires_before_class) {
        // Not a coverage problem: the package does cover this studio, it just
        // runs out first. The Cross-Location Add-On sells Locations, not time,
        // so it is the wrong remedy here — and the next package starts itself
        // on the first booking after the current one ends. Credits are offered
        // only when nothing is running yet (a Dormant plan being passed over):
        // while a package runs, nothing behind it can start.
        setBookError({
          msg:
            "Your current package runs out before this class starts, so it can't cover it." +
            (creditsCanStart ? "" : " Try again once it has ended and your next package is running."),
          offersCredit: creditsCanStart,
        });
      } else {
        setBookError({ msg: "Couldn't book this class. Please try again." });
      }
    } finally {
      setBooking(false);
    }
  };

  // The action, rendered twice: inline at the end of the row from `sm` up, and
  // on its own full-width line below it on phones. A 320px row cannot hold the
  // time, the class name and a pill-shaped button without truncating the name
  // to nothing, and the name is what the member is scanning for.
  const cta = (fullWidth: boolean) => {
    const shape = fullWidth
      ? "w-full justify-center px-4 min-h-[44px] text-sm"
      : "px-4 md:px-5 min-h-[36px] text-xs";
    if (booked)
      return (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-sage/20 text-accent-deep font-medium", shape)}>
          Booked
        </span>
      );
    if (isFull)
      return (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-warm text-muted border border-ink/10", shape)}>
          Full
        </span>
      );
    if (notCovered)
      return (
        <span className={cn("inline-flex items-center justify-center gap-1.5 rounded-full bg-warm text-muted border border-ink/10", shape)}>
          <Lock className="h-3.5 w-3.5 text-ink/40" aria-hidden />
          Not in your plan
        </span>
      );
    return (
      <button
        onClick={handleBookClick}
        disabled={booking}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors bg-accent text-white hover:bg-accent-deep disabled:opacity-70 disabled:cursor-wait",
          shape,
        )}
      >
        {booking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {booking ? "Booking…" : "Book Now"}
      </button>
    );
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-ink/5 bg-card shadow-soft transition-shadow md:hover:border-ink/15 md:hover:shadow-hover",
        "px-4 py-3.5 md:px-5 md:py-4",
        // Dim the row and its phone CTA line only — not the plan nudge, which
        // is the way through, nor a dialog opened from this row.
        (isFull || notCovered) && "[&>*:nth-child(-n+2)]:opacity-60",
      )}
    >
      <div className="flex items-center gap-3 md:gap-5">
        {/* Time */}
        <div className="w-[58px] md:w-[84px] shrink-0">
          <div
            className={cn(
              "text-sm md:text-[15px] font-semibold tracking-tight tabular-nums",
              isFull ? "text-muted" : "text-ink",
            )}
          >
            {formatClassTime(cls.starts_at)}
          </div>
          <div className="text-[11px] text-muted tabular-nums">
            – {formatClassTime(cls.ends_at)}
          </div>
        </div>

        {/* Divider */}
        <div className="hidden md:block h-9 w-px bg-ink/10 shrink-0" aria-hidden />

        {/* Class name + meta */}
        <div className="min-w-0 flex-1">
          <h4
            className={cn(
              "font-serif text-[15px] md:text-base leading-snug truncate",
              isFull ? "text-muted" : "text-ink",
            )}
          >
            {cls.class_type.name}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
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
            {/* Credit — inline on mobile (chip is shown on the right at sm+) */}
            <span className="inline-flex items-center gap-1 sm:hidden">
              <span aria-hidden className="text-ink/20">·</span>
              {cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {/* Credit chip */}
        <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 rounded-full bg-warm px-3 py-1 text-[11px] font-medium text-ink/70 tabular-nums">
          <Ticket className="h-3.5 w-3.5 text-ink/40" />
          {cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"}
        </span>

        {/* CTA — inline from sm up */}
        <div className="hidden sm:block shrink-0">{cta(false)}</div>
      </div>

      {/* CTA — its own line on phones */}
      <div className="mt-3 sm:hidden">{cta(true)}</div>

      {notCovered && planLocation && (
        <div className="mt-3 border-t border-ink/10 pt-2.5 text-xs text-muted">
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
                onClick={(e) => handleBookClick(e, true)}
                disabled={booking}
                className="underline underline-offset-2 hover:text-ink transition-colors disabled:cursor-wait"
              >
                {booking
                  ? "Booking…"
                  : `use ${cls.credit_cost} credit${cls.credit_cost === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}

      {showNoPackage && (
        <div className={SHEET_BACKDROP} onClick={() => setShowNoPackage(false)}>
          <div ref={noPackageTrapRef} role="dialog" aria-modal="true" aria-label="You need a package to book a class" tabIndex={-1} className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">You need a package to book a class</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">You&apos;re out of credits. Grab a package to keep booking.</p>
            <div className="mt-6 flex flex-col gap-2">
              <button onClick={() => router.push("/packages")} className="w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent-deep transition-colors">Buy a package</button>
              <button onClick={() => setShowNoPackage(false)} className="w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Not now</button>
            </div>
          </div>
        </div>
      )}

      {bookError && (
        <div className={SHEET_BACKDROP} onClick={() => setBookError(null)}>
          <div ref={bookErrorTrapRef} role="dialog" aria-modal="true" aria-label="Couldn't book" tabIndex={-1} className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">Couldn&apos;t book</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">{bookError.msg}</p>
            {/* Only the expiry refusal offers credits here — the wrong-studio case
                keeps its offer in the row nudge, per stories 25-27. */}
            {bookError.offersCredit && (
              <button
                onClick={(e) => handleBookClick(e, true)}
                disabled={booking}
                className="mt-6 w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent-deep transition-colors disabled:opacity-70 disabled:cursor-wait"
              >
                {booking
                  ? "Booking…"
                  : `Use ${cls.credit_cost} credit${cls.credit_cost === 1 ? "" : "s"} instead`}
              </button>
            )}
            <button onClick={() => setBookError(null)} className={cn("w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors", bookError.offersCredit ? "mt-2" : "mt-6")}>{bookError.offersCredit ? "Not now" : "Got it"}</button>
          </div>
        </div>
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
    <div className="relative min-w-0 flex-1 sm:max-w-[240px]">
      <select
        aria-label={label ?? placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full min-h-[44px] appearance-none truncate rounded-xl border bg-card px-3.5 pr-9 text-sm text-ink focus:border-accent focus:outline-none cursor-pointer transition-colors",
          value ? "border-accent/40 font-medium" : "border-ink/10",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronRight size={14} className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-muted pointer-events-none" />
    </div>
  );
}
