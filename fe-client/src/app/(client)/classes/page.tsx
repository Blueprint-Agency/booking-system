"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, formatTime, getTenantLocations, getLocationName } from "@/lib/utils";
import {
  useMockState,
  canBookClass,
  isLoggedIn,
  hasActiveUnlimited,
  getActiveClassCredits,
} from "@/lib/mock-state";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";

const typedSessions = sessionsData as Session[];
const typedInstructors = instructorsData as Instructor[];
const TENANT_LOCATIONS = getTenantLocations("tenant-1");

const ALL_YOGA_SESSIONS = typedSessions.filter(
  (s) => s.tenantId === "tenant-1" && s.type === "regular"
);


const BASE_DATE = new Date(2026, 3, 7);
const TODAY_STR = "2026-04-03";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATES_WINDOW = 15; // number of dates shown in strip

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function getInstructorName(id: string): string {
  return typedInstructors.find((i) => i.id === id)?.name ?? "Instructor";
}

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  all: "All levels",
};

function ClassRow({
  session,
  showLocation,
}: {
  session: Session;
  showLocation: boolean;
}) {
  const router = useRouter();
  const state = useMockState();
  const [showNoPackage, setShowNoPackage] = useState(false);
  const isFull = session.bookedCount >= session.capacity;
  const locationName = getLocationName(session.locationId);
  const unlimited = hasActiveUnlimited(state);
  const bundleCredits = getActiveClassCredits(state);
  const loggedIn = isLoggedIn();
  const hasPackage = loggedIn && (unlimited || bundleCredits > 0);
  const canBook = canBookClass(state);
  const needsPackage = !canBook;

  const creditsLine = unlimited
    ? "You have unlimited credits"
    : hasPackage
    ? `You have ${bundleCredits} credit${bundleCredits === 1 ? "" : "s"} left`
    : loggedIn
    ? "No credits — grab a package"
    : "Log in to see your credits";

  const handleBookClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (needsPackage) {
      setShowNoPackage(true);
      return;
    }
    if (!loggedIn) {
      router.push(`/login?next=${encodeURIComponent("/classes")}`);
      return;
    }
    router.push(`/booking/confirmation?type=class&session=${session.id}`);
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-ink/10 bg-paper px-5 py-4 transition-all hover:shadow-hover",
        "grid grid-cols-1 md:grid-cols-[96px_1.4fr_1fr_minmax(160px,auto)_auto] items-center gap-4",
        isFull && "opacity-60"
      )}
    >
      {/* Time + duration */}
      <div className="flex flex-col">
        <span className={cn("text-[15px] font-semibold tracking-tight", isFull ? "text-muted" : "text-ink")}>
          {formatTime(session.time)}
        </span>
        <span className="text-[11px] text-muted font-mono">{session.duration} min</span>
      </div>

      {/* Tag + class name + instructor */}
      <div className="flex flex-col">
        <span className="inline-flex items-center self-start rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider mb-1">
          Yoga
        </span>
        <h4 className={cn("font-serif text-[15px] leading-snug", isFull ? "text-muted" : "text-ink")}>
          {session.name}
        </h4>
        <p className="text-xs text-muted mt-0.5">{getInstructorName(session.instructorId)}</p>
      </div>

      {/* Level + location */}
      <div className="flex flex-col">
        <span className="text-xs text-ink font-medium">
          {LEVEL_LABELS[session.level] ?? session.level}
        </span>
        {showLocation && locationName && (
          <span className="text-[11px] text-muted mt-0.5">{locationName}</span>
        )}
      </div>

      {/* Credits indicator */}
      <div className="text-right">
        <p className="text-[11px] text-muted">1 credit required</p>
        <p className={cn("text-xs font-medium mt-0.5", unlimited ? "text-accent-deep" : "text-ink")}>
          {creditsLine}
        </p>
      </div>

      {/* CTA */}
      <div className="flex justify-end">
        {isFull ? (
          session.waitlistEnabled ? (
            <button
              onClick={handleBookClick}
              className="inline-flex items-center justify-center rounded-full bg-warning/15 text-warning border border-warning/30 px-5 py-2 text-xs font-medium hover:bg-warning/10 transition-colors"
            >
              Waitlist
            </button>
          ) : (
            <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-5 py-2 text-xs">
              Full
            </span>
          )
        ) : (
          <button
            onClick={handleBookClick}
            className={cn(
              "inline-flex items-center justify-center rounded-full px-5 py-2 text-xs font-medium transition-colors",
              needsPackage
                ? "bg-ink/10 text-muted hover:bg-ink/15"
                : "bg-accent text-white hover:bg-accent-deep"
            )}
          >
            Book Now
          </button>
        )}
      </div>

      {showNoPackage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
          onClick={() => setShowNoPackage(false)}
        >
          <div
            className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-serif text-xl text-ink leading-snug">
              You need a package to book a class
            </h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              {loggedIn
                ? "You're out of credits. Grab a package to keep booking."
                : "Purchase a package first, then come back to reserve this class."}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={() => router.push("/packages")}
                className="w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent-deep transition-colors"
              >
                Buy a package
              </button>
              <button
                onClick={() => setShowNoPackage(false)}
                className="w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors"
              >
                Not now
              </button>
            </div>
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

function FilterSelect({ value, onChange, options, placeholder }: FilterSelectProps) {
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

export default function ClassesPage() {
  const [dateOffset, setDateOffset] = useState(0); // scroll offset in days for the strip
  const [selectedDate, setSelectedDate] = useState<string>(toDateStr(BASE_DATE));
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [instructor, setInstructor] = useState("");
  const [level, setLevel] = useState("");

  const showLocationBadge = !selectedLocation;

  const dateStripStart = addDays(BASE_DATE, dateOffset);
  const stripDates = useMemo(
    () => Array.from({ length: DATES_WINDOW }, (_, i) => addDays(dateStripStart, i)),
    [dateStripStart]
  );

  const instructorsForTenant = useMemo(() => {
    const ids = new Set(ALL_YOGA_SESSIONS.map((s) => s.instructorId));
    return typedInstructors.filter((i) => ids.has(i.id));
  }, []);

  const sessionsForDay = useMemo(() => {
    return ALL_YOGA_SESSIONS.filter((s) => {
      if (s.date !== selectedDate) return false;
      if (s.status === "cancelled") return false;
      if (selectedLocation && s.locationId !== selectedLocation) return false;
      if (instructor && s.instructorId !== instructor) return false;
      if (level && s.level !== level) return false;
      return true;
    }).sort((a, b) => a.time.localeCompare(b.time));
  }, [selectedDate, selectedLocation, instructor, level]);

  const selDate = new Date(selectedDate + "T00:00:00");
  const monthLabel = `${MONTH_NAMES[selDate.getMonth()]} ${selDate.getFullYear()}`;

  return (
    <>
      <div id="schedule">
        <BookingSurface maxWidth="xl" padding="default">
          <SectionHeading
            eyebrow="Schedule"
            title="Book a class"
            description="Pick a day, filter the schedule, and reserve your spot."
          />

          {/* Month label + date strip */}
          <div className="flex items-center justify-between mb-3">
            <span className="font-serif text-lg text-ink">{monthLabel}</span>
          </div>

          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => setDateOffset((o) => o - DATES_WINDOW)}
              className="flex items-center justify-center w-9 h-9 text-muted border border-border rounded-lg hover:text-ink hover:bg-warm transition-colors flex-shrink-0"
              aria-label="Previous dates"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar">
              {stripDates.map((d) => {
                const ds = toDateStr(d);
                const active = ds === selectedDate;
                const isToday = ds === TODAY_STR;
                return (
                  <button
                    key={ds}
                    onClick={() => setSelectedDate(ds)}
                    className={cn(
                      "shrink-0 flex flex-col items-center justify-center w-[56px] py-2.5 rounded-xl border transition-colors",
                      active
                        ? "bg-ink text-paper border-ink"
                        : "border-ink/10 text-ink hover:border-accent hover:bg-warm"
                    )}
                  >
                    <span
                      className={cn(
                        "text-[10px] font-mono uppercase tracking-widest",
                        active ? "text-paper/70" : isToday ? "text-accent" : "text-muted"
                      )}
                    >
                      {DAY_LABELS[d.getDay()]}
                    </span>
                    <span className="text-lg font-semibold leading-tight mt-0.5">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setDateOffset((o) => o + DATES_WINDOW)}
              className="flex items-center justify-center w-9 h-9 text-muted border border-border rounded-lg hover:text-ink hover:bg-warm transition-colors flex-shrink-0"
              aria-label="Next dates"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-6">
            <FilterSelect
              value={selectedLocation}
              onChange={setSelectedLocation}
              options={TENANT_LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
              placeholder="All locations"
            />
            <FilterSelect
              value={instructor}
              onChange={setInstructor}
              options={instructorsForTenant.map((i) => ({ value: i.id, label: i.name }))}
              placeholder="All instructors"
            />
            <FilterSelect
              value={level}
              onChange={setLevel}
              options={[
                { value: "beginner", label: "Beginner" },
                { value: "intermediate", label: "Intermediate" },
                { value: "advanced", label: "Advanced" },
              ]}
              placeholder="All levels"
            />
          </div>

          {/* Class list */}
          <div className="flex flex-col gap-3">
            {sessionsForDay.length === 0 ? (
              <div className="text-center py-16 text-sm text-muted">
                No classes match your filters for this day.
              </div>
            ) : (
              sessionsForDay.map((s) => (
                <ClassRow key={s.id} session={s} showLocation={showLocationBadge} />
              ))
            )}
          </div>
        </BookingSurface>
      </div>

    </>
  );
}
