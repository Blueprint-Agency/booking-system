"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useMemberSession } from "@/lib/member-auth";
import { useClasses, useLocations, useCanBookClass, toLocalDateStr, type ApiClassCard } from "@/lib/classes";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { ClassRow, FilterSelect } from "@/components/booking/class-row";
import { ScheduleSegments } from "@/components/booking/schedule-segments";
import { ContentLoading } from "@/components/ui/content-loading";
import { BTN_SECONDARY, CARD } from "@/components/ui/styles";
import { MyNextClass } from "@/components/account/next-class-card";
import { cn } from "@/lib/utils";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import { classBookingPolicy } from "@/lib/cancellation-copy";

/** Today and the nine days after it. */
const WINDOW_DAYS = 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function windowEndISO(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function dayHeaderLabel(dateStr: string): string {
  const todayStr = toLocalDateStr(new Date().toISOString());
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const tomorrowStr = toLocalDateStr(t.toISOString());
  const d = new Date(dateStr + "T00:00:00");
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (dateStr === todayStr) return `Today · ${md}`;
  if (dateStr === tomorrowStr) return `Tomorrow · ${md}`;
  return `${d.toLocaleDateString("en-SG", { weekday: "short" })} · ${md}`;
}

export function ClassFeed() {
  const [selectedLocation, setSelectedLocation] = useState("");
  const [instructor, setInstructor] = useState("");

  const from = useMemo(() => startOfTodayISO(), []);
  const to = useMemo(() => windowEndISO(WINDOW_DAYS), []);
  const nowMs = useMemo(() => Date.now(), []);

  const { data: classes, loading, refresh } = useClasses({
    from,
    to,
    location_id: selectedLocation || undefined,
    instructor_id: instructor || undefined,
  });
  // `?? []` and not a default argument: the hook returns null while loading,
  // and a default only fires for undefined.
  const { data: locationData } = useLocations();
  const locations = useMemo(() => locationData ?? [], [locationData]);
  const { isSignedIn } = useMemberSession();
  const policy = useCancellationPolicy();
  const { canBook, loaded: canBookLoaded, entitlements } = useCanBookClass();

  const all = useMemo(() => classes ?? [], [classes]);
  const showLocationBadge = !selectedLocation;

  const instructorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of all) seen.set(c.instructor.id, c.instructor.name);
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [all]);

  const groups = useMemo(() => {
    const upcoming = all
      .filter((c) => new Date(c.starts_at).getTime() >= nowMs)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const byDay = new Map<string, ApiClassCard[]>();
    for (const c of upcoming) {
      const k = toLocalDateStr(c.starts_at);
      const arr = byDay.get(k);
      if (arr) arr.push(c);
      else byDay.set(k, [c]);
    }
    return Array.from(byDay, ([date, items]) => ({ date, items }));
  }, [all, nowMs]);

  // One day open at a time. Until the member picks one, or when a filter
  // empties the day they picked, the soonest day with classes is open.
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const openDate = groups.some((g) => g.date === pickedDate) ? pickedDate : (groups[0]?.date ?? null);

  // Opening a day collapses the one above it, which pulls the new header up
  // the page; bring it back into view once the layout has settled.
  const headerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollTo) return;
    const el = headerRefs.current.get(scrollTo);
    if (el && el.getBoundingClientRect().top < 64) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    setScrollTo(null);
  }, [scrollTo]);

  const openDay = (date: string) => {
    if (date === openDate) return;
    setPickedDate(date);
    setScrollTo(date);
  };

  const filtered = Boolean(selectedLocation || instructor);
  const clearFilters = () => {
    setSelectedLocation("");
    setInstructor("");
  };

  return (
    <BookingSurface>
      <PageHeader title="Schedule" />
      <ScheduleSegments />
      {/* A signed-in member's soonest class and its check-in QR (#192). */}
      <MyNextClass />

      <div className="grid grid-cols-2 gap-2 mb-3 sm:flex">
        <FilterSelect
          label="Location"
          value={selectedLocation}
          onChange={setSelectedLocation}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
          placeholder="All locations"
        />
        <FilterSelect
          label="Instructor"
          value={instructor}
          onChange={setInstructor}
          options={instructorOptions}
          placeholder="All instructors"
        />
      </div>

      {/* The rules a member agrees to by booking, stated before they do. Left
          out rather than guessed while the studio's policy is still loading. */}
      {policy && (
        <p className="mb-6 text-xs text-muted leading-relaxed">
          {classBookingPolicy(policy)}
        </p>
      )}

      {loading ? (
        <ContentLoading label="Loading schedule" />
      ) : groups.length === 0 ? (
        <div className={cn(CARD, "px-6 py-12 text-center")}>
          <p className="font-semibold text-ink">
            {filtered ? "No classes match these filters" : "No classes scheduled yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? "Try another location or instructor."
              : `Classes for the next ${WINDOW_DAYS} days show up here.`}
          </p>
          {filtered && (
            <button type="button" onClick={clearFilters} className={cn(BTN_SECONDARY, "mt-5")}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map(({ date, items }) => {
            const open = date === openDate;
            const label = dayHeaderLabel(date);
            const panelId = `day-${date}`;
            return (
              <section key={date} aria-label={label} className={cn(open && "mb-3")}>
                {/* The open day's header stays pinned under the top bar while
                    its classes scroll past, in the page's own colour so rows
                    slide cleanly beneath it. */}
                <h2
                  className={cn(
                    "-mx-4 px-4 md:mx-0 md:px-0",
                    open && "sticky top-16 z-10 bg-paper/95 backdrop-blur-sm",
                  )}
                >
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) headerRefs.current.set(date, el);
                      else headerRefs.current.delete(date);
                    }}
                    onClick={() => openDay(date)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className={cn(
                      // Scrolled to below the 4rem top bar, where it pins.
                      "flex w-full scroll-mt-16 items-center justify-between gap-3 py-3 text-left text-sm font-bold text-ink",
                      open ? "cursor-default" : "rounded-xl hover:text-accent",
                    )}
                  >
                    <span>{label}</span>
                    <span className="flex items-center gap-2 text-xs font-medium text-muted">
                      {items.length} {items.length === 1 ? "class" : "classes"}
                      <ChevronDown
                        aria-hidden
                        className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                      />
                    </span>
                  </button>
                </h2>
                {open && (
                  <div id={panelId} className={cn(CARD, "divide-y divide-ink/5")}>
                    {items.map((c) => (
                      <ClassRow
                        key={c.id}
                        cls={c}
                        showLocation={showLocationBadge}
                        canBook={canBook}
                        canBookLoaded={canBookLoaded}
                        isSignedIn={!!isSignedIn}
                        entitlements={entitlements}
                        onStale={refresh}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </BookingSurface>
  );
}
