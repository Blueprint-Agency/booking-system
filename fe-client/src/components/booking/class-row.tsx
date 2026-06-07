"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, UserRound, MapPin, Ticket, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError, useApi } from "@/lib/api";
import { formatClassTime, type ApiClassCard } from "@/lib/classes";

export function ClassRow({
  cls,
  showLocation,
  canBook,
  canBookLoaded,
  isSignedIn,
}: {
  cls: ApiClassCard;
  showLocation: boolean;
  canBook: boolean;
  canBookLoaded: boolean;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const api = useApi();
  const [showNoPackage, setShowNoPackage] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [booked, setBooked] = useState(cls.is_booked ?? false);
  const [spotsLeft, setSpotsLeft] = useState(cls.spots_left);
  const [booking, setBooking] = useState(false);
  const isFull = spotsLeft <= 0;
  const locationName = cls.location?.name ?? null;

  const handleBookClick = async (e: React.MouseEvent) => {
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
    try {
      await api.post("/me/bookings/class", { class_id: cls.id });
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
        "flex items-center gap-3 md:gap-5",
        isFull && "opacity-60",
      )}
    >
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

      {showNoPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setShowNoPackage(false)}>
          <div className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center" onClick={(e) => e.stopPropagation()}>
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
          <div className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">Couldn&apos;t book</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">{bookError}</p>
            <button onClick={() => setBookError(null)} className="mt-6 w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Got it</button>
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
