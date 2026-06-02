"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClassTime, durationMinutes, type ApiClassCard } from "@/lib/classes";

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
  const [showNoPackage, setShowNoPackage] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSoon, setShowSoon] = useState(false);
  const isFull = cls.spots_left <= 0;
  const locationName = cls.location?.name ?? null;

  const handleBookClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent("/")}`);
      return;
    }
    if (canBookLoaded && !canBook) {
      setShowNoPackage(true);
      return;
    }
    setShowSoon(true);
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-ink/10 bg-paper transition-all hover:shadow-hover",
        "px-4 py-3 md:px-5 md:py-4",
        "flex flex-col gap-2 md:grid md:grid-cols-[96px_1.4fr_1fr_minmax(160px,auto)_auto] md:items-center md:gap-4",
        isFull && "opacity-60",
      )}
    >
      {/* Mobile: top row — time + tag */}
      <div className="flex items-center justify-between md:hidden">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-semibold tracking-tight", isFull ? "text-muted" : "text-ink")}>
            {formatClassTime(cls.starts_at)}
          </span>
          <span className="text-[10px] text-muted font-mono">
            {durationMinutes(cls.starts_at, cls.ends_at)} min
          </span>
        </div>
        <span className="inline-flex items-center rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
          Yoga
        </span>
      </div>

      {/* Desktop: Time + duration */}
      <div className="hidden md:flex md:flex-col">
        <span className={cn("text-[15px] font-semibold tracking-tight", isFull ? "text-muted" : "text-ink")}>
          {formatClassTime(cls.starts_at)}
        </span>
        <span className="text-[11px] text-muted font-mono">
          {durationMinutes(cls.starts_at, cls.ends_at)} min
        </span>
      </div>

      {/* Desktop: Tag + class name + instructor */}
      <div className="hidden md:flex md:flex-col">
        <span className="inline-flex items-center self-start rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider mb-1">
          Yoga
        </span>
        <h4 className={cn("font-serif text-[15px] leading-snug", isFull ? "text-muted" : "text-ink")}>
          {cls.class_type.name}
        </h4>
        <p className="text-xs text-muted mt-0.5">{cls.instructor.name}</p>
      </div>

      {/* Mobile: name + instructor */}
      <div className="md:hidden">
        <h4 className={cn("font-serif text-base leading-snug", isFull ? "text-muted" : "text-ink")}>
          {cls.class_type.name}
        </h4>
        <p className="text-xs text-muted mt-0.5">
          {cls.instructor.name}
          {showLocation && locationName && (
            <>
              <span className="mx-1.5 text-ink/20">·</span>
              {locationName}
            </>
          )}
        </p>
      </div>

      {/* Desktop: instructor + location */}
      <div className="hidden md:flex md:flex-col">
        <span className="text-xs text-ink font-medium">{cls.instructor.name}</span>
        {showLocation && locationName && (
          <span className="text-[11px] text-muted mt-0.5">{locationName}</span>
        )}
      </div>

      {/* Desktop: Credits indicator */}
      <div className="hidden md:block text-right">
        <p className="text-[11px] text-muted">{cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"}</p>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setShowDetails(true); }}
          className="inline-flex items-center gap-1 text-xs font-medium mt-0.5 text-muted hover:text-ink transition-colors"
        >
          <HelpCircle size={12} />
          Learn more
        </button>
      </div>

      {/* Desktop: CTA */}
      <div className="hidden md:flex justify-end">
        {cls.is_booked ? (
          <span className="inline-flex items-center justify-center rounded-full bg-sage/20 text-accent-deep px-5 py-2 text-xs font-medium">
            Booked
          </span>
        ) : isFull ? (
          <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-5 py-2 text-xs">
            Full
          </span>
        ) : (
          <button
            onClick={handleBookClick}
            className="inline-flex items-center justify-center rounded-full px-5 py-2 text-xs font-medium transition-colors bg-accent text-white hover:bg-accent-deep"
          >
            Book Now
          </button>
        )}
      </div>

      {/* Mobile: footer — credits + CTA */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-ink/5 md:hidden">
        <span className="text-[11px] text-muted">{cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"}</span>
        {cls.is_booked ? (
          <span className="inline-flex items-center justify-center rounded-full bg-sage/20 text-accent-deep px-4 py-1.5 text-xs font-medium">Booked</span>
        ) : isFull ? (
          <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-4 py-1.5 text-xs">Full</span>
        ) : (
          <button
            onClick={handleBookClick}
            className="inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-deep transition-colors"
          >
            Book Now
          </button>
        )}
      </div>

      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setShowDetails(false)}>
          <div className="bg-paper rounded-2xl p-8 max-w-md w-full shadow-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">{cls.class_type.name}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted mt-1.5">
              <span>{cls.instructor.name}</span>
              <span>·</span>
              <span>{durationMinutes(cls.starts_at, cls.ends_at)} min</span>
              {locationName && (<><span>·</span><span>{locationName}</span></>)}
            </div>
            <p className="text-[11px] text-muted mt-4 font-mono uppercase tracking-wider">
              {cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"} required · {cls.spots_left} spot{cls.spots_left === 1 ? "" : "s"} left
            </p>
            <button onClick={() => setShowDetails(false)} className="mt-6 w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Close</button>
          </div>
        </div>
      )}

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

      {showSoon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setShowSoon(false)}>
          <div className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">Online booking is coming soon</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">You can browse the live schedule now — class booking opens shortly.</p>
            <button onClick={() => setShowSoon(false)} className="mt-6 w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Got it</button>
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
