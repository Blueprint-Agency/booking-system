"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, UserRound, MapPin, Ticket, Loader2, Lock } from "lucide-react";
import { cn, formatSgd } from "@/lib/utils";
import { ApiError, useApi } from "@/lib/api";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { formatClassTime, type ApiClassCard, type ClassEntitlements } from "@/lib/classes";

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
  const [bookError, setBookError] = useState<string | null>(null);
  const [planRefused, setPlanRefused] = useState(false);
  const [booked, setBooked] = useState(cls.is_booked ?? false);
  const [spotsLeft, setSpotsLeft] = useState(cls.spots_left);
  const [booking, setBooking] = useState(false);
  const noPackageTrapRef = useFocusTrap<HTMLDivElement>(showNoPackage);
  const bookErrorTrapRef = useFocusTrap<HTMLDivElement>(Boolean(bookError));
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
  const canUseCredit = notCovered && !!entitlements?.has_active_bundle_credits;
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
    setBookError(null);
    setPlanRefused(false);
    try {
      await api.post("/me/bookings/class", {
        class_id: cls.id,
        ...(useCredits ? { use_credits: true } : {}),
      });
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
      if (code === "insufficient_credits") {
        setShowNoPackage(true);
      } else if (code === "already_booked") {
        setBooked(true);
      } else if (code === "class_full") {
        setSpotsLeft(0);
        setBookError("Sorry, this class just filled up.");
      } else if (code === "class_already_started") {
        setBookError("This class has already started.");
      } else if (code === "location_not_covered") {
        // The lock chip below already covers the wrong-studio case, so what
        // lands here is a plan that can't reach this class's date — it runs out
        // first, or it is waiting behind one that does.
        setPlanRefused(true);
        setBookError("Your plan doesn't run long enough to cover this class.");
      } else {
        setBookError("Couldn't book this class. Please try again.");
      }
    } finally {
      setBooking(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-ink/10 bg-paper transition-all hover:border-ink/20 hover:shadow-hover",
        "px-4 py-3.5 md:px-5 md:py-4",
        (isFull || notCovered) && "opacity-60",
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
        <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 rounded-full bg-warm px-3 py-1 text-[11px] font-medium text-ink/70">
          <Ticket className="h-3.5 w-3.5 text-ink/40" />
          {cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"}
        </span>

        {/* CTA */}
        <div className="shrink-0">
          {booked ? (
            <span className="inline-flex items-center justify-center rounded-full bg-sage/20 text-accent-deep px-4 md:px-5 py-2 text-xs font-medium">
              Booked
            </span>
          ) : isFull ? (
            <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-ink/10 px-4 md:px-5 py-2 text-xs">
              Full
            </span>
          ) : notCovered ? (
            <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-warm text-muted border border-ink/10 px-4 md:px-5 py-2 text-xs">
              <Lock className="h-3.5 w-3.5 text-ink/40" aria-hidden />
              Not in your plan
            </span>
          ) : (
            <button
              onClick={handleBookClick}
              disabled={booking}
              className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 md:px-5 py-2 text-xs font-medium transition-colors bg-accent text-white hover:bg-accent-deep disabled:opacity-70 disabled:cursor-wait"
            >
              {booking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {booking ? "Booking…" : "Book Now"}
            </button>
          )}
        </div>
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setShowNoPackage(false)}>
          <div ref={noPackageTrapRef} role="dialog" aria-modal="true" aria-label="You need a package to book a class" tabIndex={-1} className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center outline-none" onClick={(e) => e.stopPropagation()}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setBookError(null)}>
          <div ref={bookErrorTrapRef} role="dialog" aria-modal="true" aria-label="Couldn't book" tabIndex={-1} className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center outline-none" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">Couldn&apos;t book</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">{bookError}</p>
            {/* The plan refused this class — a member holding credits still has a
                way through, which is the whole point of use_credits. */}
            {planRefused && entitlements?.has_active_bundle_credits && (
              <button
                onClick={(e) => handleBookClick(e, true)}
                disabled={booking}
                className="mt-6 w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent-deep transition-colors disabled:cursor-wait"
              >
                {booking
                  ? "Booking…"
                  : `Use ${cls.credit_cost} credit${cls.credit_cost === 1 ? "" : "s"} instead`}
              </button>
            )}
            <button onClick={() => setBookError(null)} className="mt-2 w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Got it</button>
          </div>
        </div>
      )}
    </div>
  );
}

type FilterSelectProps = {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
};

export function FilterSelect({ value, onChange, options, placeholder }: FilterSelectProps) {
  return (
    <div className="relative flex-1 min-w-[160px]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-ink/10 bg-paper px-4 py-2.5 pr-9 text-sm text-ink focus:border-accent focus:outline-none cursor-pointer"
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
