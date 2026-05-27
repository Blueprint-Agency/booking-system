"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { Info, CalendarX, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PRIVATE_SESSION_CANCELLATION_POLICY } from "@/data/policy";
import {
  useInstructors,
  useLocations,
  usePtAvailability,
  toLocalDateStr,
  formatClassTime,
  durationMinutes,
  type ApiPtSlot,
} from "@/lib/classes";

type Slot = ApiPtSlot & { instructorName: string };

const MAX_RANGE_DAYS = 14;
const DAYS_PER_PAGE = 7;

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
function sessionTypeLabel(t: "1on1" | "2on1"): string {
  return t === "1on1" ? "1-on-1" : "2-on-1";
}

export default function PrivateSessionsPage() {
  const today = new Date().toISOString().split("T")[0];

  const { data: instructors } = useInstructors();
  const { data: locations } = useLocations();

  const [instructorFilter, setInstructorFilter] = useState<string>("any");
  const [locationFilter, setLocationFilter] = useState<string>("any");
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(addDays(today, MAX_RANGE_DAYS - 1));
  const maxToDate = addDays(fromDate, MAX_RANGE_DAYS - 1);

  const [appliedFilters, setAppliedFilters] = useState({
    instructor: "any",
    location: "any",
    from: today,
    to: addDays(today, MAX_RANGE_DAYS - 1),
  });

  const instructorIds = useMemo(() => {
    if (!instructors) return [];
    if (appliedFilters.instructor !== "any") return [appliedFilters.instructor];
    return instructors.map((i) => i.id);
  }, [instructors, appliedFilters.instructor]);

  const { data: rawSlots, loading } = usePtAvailability(instructorIds);

  const instructorNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of instructors ?? []) m.set(i.id, i.name);
    return m;
  }, [instructors]);

  const filteredSlots = useMemo<Slot[]>(() => {
    return (rawSlots ?? [])
      .map((s) => ({ ...s, instructorName: instructorNameById.get(s.instructor_id) ?? "Instructor" }))
      .filter((s) => {
        const date = toLocalDateStr(s.starts_at);
        if (appliedFilters.location !== "any" && s.location?.id !== appliedFilters.location) return false;
        if (date < appliedFilters.from) return false;
        if (date > appliedFilters.to) return false;
        return true;
      });
  }, [rawSlots, instructorNameById, appliedFilters]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of filteredSlots) {
      const date = toLocalDateStr(s.starts_at);
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredSlots]);

  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  function toggleDay(date: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

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

  const totalPages = Math.ceil(grouped.length / DAYS_PER_PAGE);

  return (
    <>
      <div id="form">
        <BookingSurface maxWidth="lg" padding="default">
          <SectionHeading eyebrow="Private sessions" title="Find a time that works" />

          {/* Primary CTA — new request flow (no back-and-forth in app). */}
          <div className="mt-6 mb-8 rounded-2xl border border-accent/30 bg-accent/5 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Request a private session</p>
              <p className="text-xs text-muted mt-0.5">
                Pick a class type, propose a few time windows — we&apos;ll confirm on WhatsApp.
              </p>
            </div>
            <Link
              href="/private-sessions/request"
              className="shrink-0 inline-flex items-center justify-center rounded-full bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:bg-ink/90 transition-colors"
            >
              Submit a request
            </Link>
          </div>

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
                <li>Browse available times by instructor, location, or date.</li>
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
                <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">Instructor</label>
                <select
                  value={instructorFilter}
                  onChange={(e) => setInstructorFilter(e.target.value)}
                  className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="any">Any instructor</option>
                  {(instructors ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">Location</label>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="any">Any location</option>
                  {(locations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-1 md:col-span-2 lg:col-span-2 grid grid-cols-2 gap-3 md:gap-5">
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">From</label>
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
                  <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">To</label>
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
              <p className="text-xs uppercase tracking-wider text-muted">Available times</p>
              <p className="text-xs text-muted">
                {filteredSlots.length} {filteredSlots.length === 1 ? "slot" : "slots"}
              </p>
            </div>

            {loading ? (
              <div className="text-center py-16 text-sm text-muted">Loading availability…</div>
            ) : grouped.length === 0 ? (
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
                      <div key={date} className="rounded-2xl border border-ink/10 bg-card overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleDay(date)}
                          aria-expanded={isOpen}
                          className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-warm/60 transition-colors"
                        >
                          <span className="text-sm font-medium text-ink">{formatDateLabel(date)}</span>
                          <span className="flex items-center gap-3">
                            <span className="text-xs text-muted">
                              {slots.length} {slots.length === 1 ? "slot" : "slots"}
                            </span>
                            <ChevronDown size={16} className={`text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
                                      <span className="text-sm font-medium text-ink">{formatClassTime(slot.starts_at)}</span>
                                      <span className="text-xs text-muted">{durationMinutes(slot.starts_at, slot.ends_at)} min</span>
                                    </div>
                                    <p className="text-xs text-muted mt-1.5 leading-relaxed">
                                      {slot.instructorName}
                                      {slot.location ? ` · ${slot.location.name}` : ""}
                                    </p>
                                    <p className="text-[11px] text-accent-deep mt-1">
                                      {sessionTypeLabel(slot.session_type)} · {slot.spots_left} spot{slot.spots_left === 1 ? "" : "s"} left
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
                {totalPages > 1 && (
                  <div className="mt-8 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-4 py-2 text-sm text-ink disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm transition-colors"
                    >
                      <ChevronLeft size={14} /> Prev
                    </button>
                    <p className="text-xs text-muted">Week {page + 1} of {totalPages}</p>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-4 py-2 text-sm text-ink disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm transition-colors"
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Policy footnote */}
          <p className="text-xs text-muted mt-12 leading-relaxed">
            Reschedule or cancel up to {PRIVATE_SESSION_CANCELLATION_POLICY.window} before your session at no charge.
            See <Link href="/packages#private" className="underline hover:text-ink">private session packages</Link> for pricing.
          </p>
        </BookingSurface>
      </div>

      {/* Slot detail modal — request submission is coming soon */}
      <AnimatePresence>
        {selectedSlot && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4"
            onClick={() => setSelectedSlot(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-card rounded-2xl p-7 max-w-sm w-full shadow-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs uppercase tracking-wider text-muted mb-2">Private session</p>
              <h2 className="font-serif text-xl text-ink mb-4">{selectedSlot.instructorName}</h2>

              <div className="rounded-xl border border-ink/10 bg-warm p-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Date</span>
                  <span className="text-ink font-medium">{formatDateLabel(toLocalDateStr(selectedSlot.starts_at))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Time</span>
                  <span className="text-ink font-medium">{formatClassTime(selectedSlot.starts_at)}</span>
                </div>
                {selectedSlot.location && (
                  <div className="flex justify-between">
                    <span className="text-muted">Location</span>
                    <span className="text-ink font-medium">{selectedSlot.location.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted">Type</span>
                  <span className="text-ink font-medium">{sessionTypeLabel(selectedSlot.session_type)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Duration</span>
                  <span className="text-ink font-medium">{durationMinutes(selectedSlot.starts_at, selectedSlot.ends_at)} min</span>
                </div>
              </div>

              <p className="text-sm text-muted mt-4 leading-relaxed">
                Online private-session requests are coming soon. In the meantime, reach out to the studio to book this slot.
              </p>

              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setSelectedSlot(null)}
                  className="flex-1 rounded-full border border-ink/15 text-ink px-4 py-2.5 text-sm font-medium hover:bg-warm transition-colors"
                >
                  Close
                </button>
                <Link
                  href="/packages#private"
                  className="flex-1 text-center rounded-full bg-ink text-paper px-4 py-2.5 text-sm font-medium hover:bg-ink/90 transition-colors"
                >
                  View packages
                </Link>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
