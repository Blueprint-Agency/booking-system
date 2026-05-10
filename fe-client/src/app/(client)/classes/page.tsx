"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
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

const TODAY = new Date(2026, 4, 9); // mock "today" matching app data era
const TODAY_STR = toDateStr(TODAY);
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SESSION_DATE_SET = new Set(ALL_YOGA_SESSIONS.map((s) => s.date));

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=Sun … 6=Sat
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - startOffset + i));
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
  const [showDetails, setShowDetails] = useState(false);
  const isFull = session.bookedCount >= session.capacity;
  const locationName = getLocationName(session.locationId);
  const unlimited = hasActiveUnlimited(state);
  const bundleCredits = getActiveClassCredits(state);
  const loggedIn = isLoggedIn();
  const hasPackage = loggedIn && (unlimited || bundleCredits > 0);
  const canBook = canBookClass(state);
  const needsPackage = !canBook;

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
        "rounded-2xl border border-ink/10 bg-paper transition-all hover:shadow-hover",
        "px-4 py-3 md:px-5 md:py-4",
        "flex flex-col gap-2 md:grid md:grid-cols-[96px_1.4fr_1fr_minmax(160px,auto)_auto] md:items-center md:gap-4",
        isFull && "opacity-60"
      )}
    >
      {/* Mobile: top row — time + tag */}
      <div className="flex items-center justify-between md:hidden">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-semibold tracking-tight", isFull ? "text-muted" : "text-ink")}>
            {formatTime(session.time)}
          </span>
          <span className="text-[10px] text-muted font-mono">{session.duration} min</span>
        </div>
        <span className="inline-flex items-center rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
          Yoga
        </span>
      </div>

      {/* Desktop: Time + duration */}
      <div className="hidden md:flex md:flex-col">
        <span className={cn("text-[15px] font-semibold tracking-tight", isFull ? "text-muted" : "text-ink")}>
          {formatTime(session.time)}
        </span>
        <span className="text-[11px] text-muted font-mono">{session.duration} min</span>
      </div>

      {/* Desktop: Tag + class name + instructor */}
      <div className="hidden md:flex md:flex-col">
        <span className="inline-flex items-center self-start rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider mb-1">
          Yoga
        </span>
        <h4 className={cn("font-serif text-[15px] leading-snug", isFull ? "text-muted" : "text-ink")}>
          {session.name}
        </h4>
        <p className="text-xs text-muted mt-0.5">{getInstructorName(session.instructorId)}</p>
      </div>

      {/* Mobile: name + instructor */}
      <div className="md:hidden">
        <h4 className={cn("font-serif text-base leading-snug", isFull ? "text-muted" : "text-ink")}>
          {session.name}
        </h4>
        <p className="text-xs text-muted mt-0.5">
          {getInstructorName(session.instructorId)}
          <span className="mx-1.5 text-ink/20">·</span>
          {LEVEL_LABELS[session.level] ?? session.level}
          {showLocation && locationName && (
            <>
              <span className="mx-1.5 text-ink/20">·</span>
              {locationName}
            </>
          )}
        </p>
      </div>

      {/* Desktop: Level + location */}
      <div className="hidden md:flex md:flex-col">
        <span className="text-xs text-ink font-medium">
          {LEVEL_LABELS[session.level] ?? session.level}
        </span>
        {showLocation && locationName && (
          <span className="text-[11px] text-muted mt-0.5">{locationName}</span>
        )}
      </div>

      {/* Mobile: footer — credits/learn more + CTA */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-ink/5 md:hidden">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span>1 credit</span>
          <span className="text-ink/20">·</span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setShowDetails(true);
            }}
            className="inline-flex items-center gap-1 hover:text-ink transition-colors"
          >
            <HelpCircle size={11} />
            Learn more
          </button>
        </div>
        {isFull ? (
          session.waitlistEnabled ? (
            <button
              onClick={handleBookClick}
              className="inline-flex items-center justify-center rounded-full bg-warning/15 text-warning border border-warning/30 px-4 py-1.5 text-xs font-medium hover:bg-warning/10 transition-colors"
            >
              Waitlist
            </button>
          ) : (
            <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-4 py-1.5 text-xs">
              Full
            </span>
          )
        ) : (
          <button
            onClick={handleBookClick}
            className={cn(
              "inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
              needsPackage
                ? "bg-ink/10 text-muted hover:bg-ink/15"
                : "bg-accent text-white hover:bg-accent-deep"
            )}
          >
            Book Now
          </button>
        )}
      </div>

      {/* Desktop: Credits indicator */}
      <div className="hidden md:block text-right">
        <p className="text-[11px] text-muted">1 credit required</p>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setShowDetails(true);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium mt-0.5 text-muted hover:text-ink transition-colors"
        >
          <HelpCircle size={12} />
          Learn more
        </button>
      </div>

      {/* Desktop: CTA */}
      <div className="hidden md:flex justify-end">
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

      {showDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
          onClick={() => setShowDetails(false)}
        >
          <div
            className="bg-paper rounded-2xl p-8 max-w-md w-full shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="inline-flex items-center rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
              Yoga
            </span>
            <h3 className="font-serif text-xl text-ink leading-snug mt-3">
              {session.name}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted mt-1.5">
              <span>{getInstructorName(session.instructorId)}</span>
              <span>·</span>
              <span>{LEVEL_LABELS[session.level] ?? session.level}</span>
              <span>·</span>
              <span>{session.duration} min</span>
            </div>
            <p className="text-sm text-ink/80 mt-4 leading-relaxed">
              {session.description}
            </p>
            <p className="text-[11px] text-muted mt-4 font-mono uppercase tracking-wider">
              1 credit required
            </p>
            <button
              onClick={() => setShowDetails(false)}
              className="mt-6 w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

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
  const [calMonth, setCalMonth] = useState({
    year: TODAY.getFullYear(),
    month: TODAY.getMonth(),
  });
  const [selectedDate, setSelectedDate] = useState<string>(TODAY_STR);
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [instructor, setInstructor] = useState("");
  const [level, setLevel] = useState("");

  const showLocationBadge = !selectedLocation;

  const calDays = useMemo(
    () => getMonthGrid(calMonth.year, calMonth.month),
    [calMonth]
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

  const monthLabel = `${MONTH_NAMES[calMonth.month]} ${calMonth.year}`;

  const selDateObj = new Date(selectedDate + "T00:00:00");
  const selectedDateLabel = selDateObj.toLocaleDateString("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  function goToPrevMonth() {
    setCalMonth(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
    );
  }

  function goToNextMonth() {
    setCalMonth(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
    );
  }

  function goToToday() {
    setCalMonth({ year: TODAY.getFullYear(), month: TODAY.getMonth() });
    setSelectedDate(TODAY_STR);
  }

  return (
    <>
      <div id="schedule">
        <BookingSurface maxWidth="xl" padding="default">
          <SectionHeading
            eyebrow="Schedule"
            title="Book a class"
            description="Pick a day, filter the schedule, and reserve your spot."
          />

          {/* Calendar */}
          <div className="rounded-2xl border border-ink/10 bg-paper overflow-hidden mb-6">

            {/* Calendar header */}
            <div className="flex items-center px-4 py-3 border-b border-ink/10">
              <button
                onClick={goToToday}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-ink/15 text-ink hover:bg-warm transition-colors"
              >
                Today
              </button>
              <div className="flex-1 flex items-center justify-center gap-2">
                <button
                  onClick={goToPrevMonth}
                  className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-warm text-muted hover:text-ink transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="font-serif text-base text-ink w-40 text-center select-none">
                  {monthLabel}
                </span>
                <button
                  onClick={goToNextMonth}
                  className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-warm text-muted hover:text-ink transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
              {/* Spacer balances the Today button */}
              <div className="w-[60px]" />
            </div>

            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-ink/10">
              {DAY_LABELS.map((d) => (
                <div
                  key={d}
                  className="py-2 text-center text-[10px] font-mono uppercase tracking-wider text-muted"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Date grid — 6 rows × 7 cols */}
            <div className="grid grid-cols-7">
              {calDays.map((d, i) => {
                const ds = toDateStr(d);
                const isCurrentMonth = d.getMonth() === calMonth.month;
                const isSelected = ds === selectedDate;
                const isToday = ds === TODAY_STR;
                const hasClasses = SESSION_DATE_SET.has(ds) && isCurrentMonth;
                const isLastCol = (i + 1) % 7 === 0;
                const isLastRow = i >= 35;

                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (isCurrentMonth) setSelectedDate(ds);
                    }}
                    disabled={!isCurrentMonth}
                    className={cn(
                      "relative flex flex-col items-center justify-start pt-2 pb-2 min-h-[56px] md:min-h-[68px] transition-colors",
                      !isLastCol && "border-r border-ink/5",
                      !isLastRow && "border-b border-ink/5",
                      isCurrentMonth && !isSelected
                        ? "hover:bg-warm cursor-pointer"
                        : "cursor-default"
                    )}
                  >
                    <span
                      className={cn(
                        "w-7 h-7 flex items-center justify-center rounded-full text-sm leading-none transition-colors",
                        isSelected
                          ? "bg-ink text-paper font-semibold"
                          : isToday
                          ? "ring-2 ring-accent text-accent font-semibold"
                          : isCurrentMonth
                          ? "text-ink"
                          : "text-muted/25"
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {hasClasses && (
                      <span
                        className={cn(
                          "mt-1 w-1.5 h-1.5 rounded-full",
                          isSelected ? "bg-paper" : "bg-accent"
                        )}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected date label */}
          <p className="font-serif text-base text-ink mb-4">{selectedDateLabel}</p>

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
                No classes scheduled for this day.
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
