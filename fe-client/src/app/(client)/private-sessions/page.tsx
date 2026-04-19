"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { Info, CalendarX, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { MOCK_USER } from "@/data/mock-user";
import { useMockState, recordBooking, decrementPrivateCredit } from "@/lib/mock-state";
import { PRIVATE_SESSION_CANCELLATION_POLICY } from "@/data/policy";
import type { Instructor, Location } from "@/types";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const typedInstructors = instructorsData as Instructor[];
const typedLocations = locationsData as Location[];

void MOCK_USER;

const TIMES_OF_DAY = ["7:00 AM", "9:00 AM", "11:00 AM", "2:00 PM", "5:00 PM", "7:00 PM"];
const PRICE_PER_SESSION = 120;
const DURATION_MINS = 60;

type Slot = {
  id: string;
  instructorId: string;
  instructorName: string;
  locationId: string;
  locationName: string;
  date: string; // YYYY-MM-DD
  time: string;
};

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/** Deterministic pseudo-random based on string seed. */
function seededAvailable(seed: string): boolean {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 100 < 26; // ~26% available (reduced by 60% from prior ~66%)
}

function generateSlots(rangeDays: number): Slot[] {
  const today = new Date().toISOString().split("T")[0];
  const slots: Slot[] = [];
  for (let d = 0; d < rangeDays; d++) {
    const date = addDays(today, d);
    for (const instructor of typedInstructors) {
      if (!instructor.available) continue;
      for (const locId of instructor.locationIds) {
        const loc = typedLocations.find((l) => l.id === locId);
        if (!loc) continue;
        for (const time of TIMES_OF_DAY) {
          const seed = `${instructor.id}-${locId}-${date}-${time}`;
          if (!seededAvailable(seed)) continue;
          slots.push({
            id: seed,
            instructorId: instructor.id,
            instructorName: instructor.name,
            locationId: locId,
            locationName: loc.shortName ?? loc.name,
            date,
            time,
          });
        }
      }
    }
  }
  return slots;
}

export default function PrivateSessionsPage() {
  const [instructorFilter, setInstructorFilter] = useState<string>("any");
  const [locationFilter, setLocationFilter] = useState<string>("any");
  const today = new Date().toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(addDays(today, 13));

  const [appliedFilters, setAppliedFilters] = useState({
    instructor: "any",
    location: "any",
    from: today,
    to: addDays(today, 13),
  });

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [sessionType, setSessionType] = useState<"pt1on1" | "pt2on1">("pt1on1");
  const [submitted, setSubmitted] = useState(false);

  const mockState = useMockState();
  const now = new Date();
  const pt1on1Credits = mockState.packages
    .filter((p) => p.kind === "pt1on1" && new Date(p.expiresAt) > now)
    .reduce((sum, p) => sum + p.credits, 0);
  const pt2on1Credits = mockState.packages
    .filter((p) => p.kind === "pt2on1" && new Date(p.expiresAt) > now)
    .reduce((sum, p) => sum + p.credits, 0);

  useEffect(() => {
    if (!selectedSlot) return;
    if (sessionType === "pt1on1" && pt1on1Credits <= 0 && pt2on1Credits > 0) {
      setSessionType("pt2on1");
    } else if (sessionType === "pt2on1" && pt2on1Credits <= 0 && pt1on1Credits > 0) {
      setSessionType("pt1on1");
    }
  }, [selectedSlot, sessionType, pt1on1Credits, pt2on1Credits]);
  const hasAnyCredit = pt1on1Credits > 0 || pt2on1Credits > 0;
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const DAYS_PER_PAGE = 7;
  const MAX_RANGE_DAYS = 14;
  const maxToDate = addDays(fromDate, MAX_RANGE_DAYS - 1);

  function toggleDay(date: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  const allSlots = useMemo(() => generateSlots(30), []);

  const filteredSlots = useMemo(() => {
    return allSlots.filter((s) => {
      if (appliedFilters.instructor !== "any" && s.instructorId !== appliedFilters.instructor)
        return false;
      if (appliedFilters.location !== "any" && s.locationId !== appliedFilters.location)
        return false;
      if (s.date < appliedFilters.from) return false;
      if (s.date > appliedFilters.to) return false;
      return true;
    });
  }, [allSlots, appliedFilters]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of filteredSlots) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredSlots]);

  function handleFind() {
    const clampedTo = toDate > maxToDate ? maxToDate : toDate;
    if (clampedTo !== toDate) setToDate(clampedTo);
    setAppliedFilters({
      instructor: instructorFilter,
      location: locationFilter,
      from: fromDate,
      to: clampedTo,
    });
    setPage(0);
  }

  function handleConfirm() {
    if (!selectedSlot) return;
    // Parse "9:00 AM" → 24h "HH:mm"
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(selectedSlot.time.trim());
    let hh = 9, mm = 0;
    if (m) {
      hh = parseInt(m[1], 10) % 12;
      if (/pm/i.test(m[3])) hh += 12;
      mm = parseInt(m[2], 10);
    }
    const startsAt = `${selectedSlot.date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
    recordBooking({
      id: `pvt-${Date.now()}`,
      sessionId: `private:${selectedSlot.instructorId}:${selectedSlot.id}`,
      type: "private",
      bookedAt: new Date().toISOString(),
      meta: {
        name: `Private session with ${selectedSlot.instructorName}`,
        instructorId: selectedSlot.instructorId,
        instructorName: selectedSlot.instructorName,
        locationId: selectedSlot.locationId,
        locationName: selectedSlot.locationName,
        startsAt,
        duration: DURATION_MINS,
      },
    });
    decrementPrivateCredit();
    setSubmitted(true);
  }

  return (
    <>
      <div id="form">
        <BookingSurface maxWidth="lg" padding="default">
          <SectionHeading eyebrow="Private sessions" title="Find a time that works" />

          {/* How private sessions work */}
          <details className="group mb-6 md:mb-10 rounded-2xl border border-border bg-warm">
            <summary className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <Info size={16} className="text-accent shrink-0" />
                <span className="text-sm font-semibold text-ink">How private sessions work</span>
              </span>
              <ChevronDown size={14} className="text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 md:px-5 md:pb-5">
              <ul className="text-xs text-muted leading-relaxed space-y-1 list-disc pl-6">
                <li>Browse available slots by instructor, location, or date.</li>
                <li>Submit a request — no upfront payment needed.</li>
                <li>We confirm within <span className="font-medium text-ink">12 hours</span>.</li>
                <li>Private packages are counted in sessions (1 session = 30 mins).</li>
              </ul>
            </div>
          </details>

          {/* Filters */}
          <div className="rounded-2xl border border-ink/10 bg-paper p-4 sm:p-6 md:p-7">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
              <div>
                <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">
                  Instructor
                </label>
                <select
                  value={instructorFilter}
                  onChange={(e) => setInstructorFilter(e.target.value)}
                  className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="any">Any instructor</option>
                  {typedInstructors.map((i) => (
                    <option key={i.id} value={i.id} disabled={!i.available}>
                      {i.name}{i.available ? "" : " — Not Available"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">
                  Location
                </label>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="any">Any location</option>
                  {typedLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-1 md:col-span-2 lg:col-span-2 grid grid-cols-2 gap-3 md:gap-5">
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">
                    From
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    min={today}
                    onChange={(e) => {
                      const newFrom = e.target.value;
                      setFromDate(newFrom);
                      const newMax = addDays(newFrom, MAX_RANGE_DAYS - 1);
                      if (toDate > newMax || toDate < newFrom) setToDate(newMax);
                    }}
                    className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent cursor-pointer"
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">
                    To
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate}
                    max={maxToDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 md:mt-7 flex justify-center">
              <button
                type="button"
                onClick={handleFind}
                className="w-full md:w-auto rounded-full bg-ink text-paper px-6 py-2.5 text-sm font-medium hover:bg-ink/90 transition-colors"
              >
                Find availability
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="mt-12">
            <div className="flex items-baseline justify-between mb-6">
              <p className="text-xs uppercase tracking-wider text-muted">
                Available times
              </p>
              <p className="text-xs text-muted">
                {filteredSlots.length} {filteredSlots.length === 1 ? "slot" : "slots"}
              </p>
            </div>

            {grouped.length === 0 ? (
              <EmptyState
                icon={CalendarX}
                title="No availability"
                description="Try a different instructor, location, or wider date range."
              />
            ) : (
              <>
              <div className="space-y-4">
                {grouped.slice(page * DAYS_PER_PAGE, page * DAYS_PER_PAGE + DAYS_PER_PAGE).map(([date, slots]) => {
                  const isOpen = openDays.has(date);
                  return (
                    <div
                      key={date}
                      className="rounded-2xl border border-ink/10 bg-card overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDay(date)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-warm/60 transition-colors"
                      >
                        <span className="text-sm font-medium text-ink">
                          {formatDateLabel(date)}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="text-xs text-muted">
                            {slots.length} {slots.length === 1 ? "slot" : "slots"}
                          </span>
                          <ChevronDown
                            size={16}
                            className={`text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-5 border-t border-ink/10">
                              {slots.map((slot) => (
                                <button
                                  key={slot.id}
                                  type="button"
                                  onClick={() => setSelectedSlot(slot)}
                                  className="rounded-xl border border-ink/10 bg-paper p-4 text-left hover:border-accent transition-colors"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-ink">
                                      {slot.time}
                                    </span>
                                    <span className="text-xs text-muted">
                                      {DURATION_MINS} min
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted mt-1.5 leading-relaxed">
                                    {slot.instructorName} · {slot.locationName}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
              {grouped.length > DAYS_PER_PAGE && (() => {
                const totalPages = Math.ceil(grouped.length / DAYS_PER_PAGE);
                return (
                  <div className="mt-8 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-4 py-2 text-sm text-ink disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm transition-colors"
                    >
                      <ChevronLeft size={14} /> Prev
                    </button>
                    <p className="text-xs text-muted">
                      Week {page + 1} of {totalPages}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-4 py-2 text-sm text-ink disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm transition-colors"
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                );
              })()}
              </>
            )}
          </div>

          {/* Policy footnote */}
          <p className="text-xs text-muted mt-12 leading-relaxed">
            Reschedule or cancel up to {PRIVATE_SESSION_CANCELLATION_POLICY.window} before your
            session at no charge. Sessions are S${PRICE_PER_SESSION} each.
          </p>
        </BookingSurface>
      </div>


      {/* Confirm slot modal */}
      <AnimatePresence>
        {selectedSlot && !submitted && !hasAnyCredit && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
            onClick={() => setSelectedSlot(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-serif text-xl text-ink leading-snug">
                You need a package to book a private session
              </h3>
              <p className="text-sm text-muted mt-2 leading-relaxed">
                Private sessions are covered by 1-on-1 or 2-on-1 packages. Purchase one to request this slot.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <Link
                  href="/packages#private"
                  className="w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent-deep transition-colors"
                >
                  Buy a private session package
                </Link>
                <button
                  type="button"
                  onClick={() => setSelectedSlot(null)}
                  className="w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors"
                >
                  Not now
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {selectedSlot && !submitted && hasAnyCredit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-card rounded-2xl p-7 max-w-sm w-full shadow-modal"
            >
              <p className="text-xs uppercase tracking-wider text-muted mb-2">
                Confirm request
              </p>
              <h2 className="font-serif text-xl text-ink mb-4">
                {selectedSlot.instructorName}
              </h2>

              <div className="mb-4">
                <p className="text-xs uppercase tracking-wider text-muted mb-2">
                  Session type
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "pt1on1", label: "1-on-1", credits: pt1on1Credits },
                    { key: "pt2on1", label: "2-on-1", credits: pt2on1Credits },
                  ] as const).map((opt) => {
                    const active = sessionType === opt.key;
                    const disabled = opt.credits <= 0;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && setSessionType(opt.key)}
                        className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          disabled
                            ? "border-ink/10 bg-ink/[0.03] opacity-50 cursor-not-allowed"
                            : active
                              ? "border-accent bg-accent/5"
                              : "border-ink/10 hover:border-accent"
                        }`}
                      >
                        <span className={`block text-sm font-medium ${disabled ? "text-muted" : "text-ink"}`}>
                          {opt.label}
                        </span>
                        <span className="block text-[11px] text-muted mt-0.5">
                          {opt.credits > 0
                            ? `${opt.credits} credit${opt.credits === 1 ? "" : "s"} left`
                            : "No package owned"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-ink/10 bg-warm p-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Date</span>
                  <span className="text-ink font-medium">
                    {formatDateLabel(selectedSlot.date)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Time</span>
                  <span className="text-ink font-medium">{selectedSlot.time}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Location</span>
                  <span className="text-ink font-medium">{selectedSlot.locationName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Duration</span>
                  <span className="text-ink font-medium">{DURATION_MINS} min</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-ink/10 mt-2">
                  <span className="text-muted">Price</span>
                  <span className="text-ink font-semibold">S${PRICE_PER_SESSION}</span>
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setSelectedSlot(null)}
                  className="flex-1 rounded-full border border-ink/15 text-ink px-4 py-2.5 text-sm font-medium hover:bg-warm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!hasAnyCredit}
                  className="flex-1 rounded-full bg-ink text-paper px-4 py-2.5 text-sm font-medium hover:bg-ink/90 disabled:bg-ink/30 disabled:cursor-not-allowed transition-colors"
                >
                  Send request
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success */}
      <AnimatePresence>
        {submitted && selectedSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="bg-card rounded-2xl p-8 max-w-sm w-full shadow-modal text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                className="w-16 h-16 rounded-full bg-sage/15 flex items-center justify-center mx-auto mb-5"
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-sage"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </motion.div>

              <h2 className="font-serif text-2xl text-ink mb-2">Request received!</h2>
              <p className="text-sm text-muted leading-relaxed mb-5">
                We&apos;ve noted your interest in a private session with{" "}
                <span className="font-medium text-ink">{selectedSlot.instructorName}</span> on{" "}
                <span className="font-medium text-ink">
                  {formatDateLabel(selectedSlot.date)} at {selectedSlot.time}
                </span>
                . Our team will reach out within{" "}
                <span className="font-medium text-ink">12 hours</span> to confirm.
              </p>

              <div className="flex flex-col gap-2">
                <Link
                  href="/account/private-sessions"
                  className="block w-full py-3 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors"
                >
                  View my bookings
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setSelectedSlot(null);
                    setSessionType("pt1on1");
                  }}
                  className="block w-full py-2.5 text-sm font-medium text-muted hover:text-ink transition-colors"
                >
                  Book another
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
