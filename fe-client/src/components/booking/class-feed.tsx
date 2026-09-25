"use client";

import { useMemo, useState } from "react";
import { useMemberSession } from "@/lib/member-auth";
import { useClasses, useLocations, useCanBookClass, toLocalDateStr, type ApiClassCard } from "@/lib/classes";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { ClassRow, FilterSelect } from "@/components/booking/class-row";
import { ScheduleSegments } from "@/components/booking/schedule-segments";
import { Skeleton } from "@/components/ui/skeleton";
import { MyNextClass } from "@/components/account/next-class-card";
import { useBrand } from "@/components/brand/brand-provider";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import { classBookingPolicy } from "@/lib/cancellation-copy";

const WINDOW_DAYS = 30;
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

  const { data: classes, loading } = useClasses({
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
  const brand = useBrand();
  const policy = useCancellationPolicy();

  // The studio and its own premises — both per Tenant, so a second studio's
  // members never read the first studio's name or the first studio's addresses.
  // The premises are dropped rather than guessed at while they load.
  const eyebrow = useMemo(() => {
    const names = locations.map((l) => l.name).filter(Boolean);
    return names.length ? `${brand.name} · ${names.join(" & ")}` : brand.name;
  }, [brand.name, locations]);
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

  const filtered = Boolean(selectedLocation || instructor);
  const clearFilters = () => {
    setSelectedLocation("");
    setInstructor("");
  };

  return (
    <BookingSurface maxWidth="xl" flush>
      <ScheduleSegments />
      {/* A signed-in member's soonest class and its check-in QR (#192). */}
      <MyNextClass />
      <SectionHeading
        eyebrow={eyebrow}
        title="Book a class"
        description={`All upcoming classes across ${
          locations.length === 1 ? "the studio" : "every studio"
        } — book your spot.`}
      />

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
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading schedule">
          <Skeleton className="h-5 w-40 mb-1" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] sm:h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/15 px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">
            {filtered
              ? "No classes match these filters"
              : `No upcoming classes in the next ${WINDOW_DAYS} days`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? "Try another location or instructor."
              : "New classes show up here as soon as the studio schedules them."}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-5 inline-flex min-h-[44px] items-center rounded-full border border-ink/15 px-5 text-sm font-medium text-ink hover:border-accent transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6 md:gap-8">
          {groups.map(({ date, items }) => (
            <section key={date} aria-label={dayHeaderLabel(date)}>
              {/* Pinned under the top bar while its day scrolls past, in the
                  surface's own colour so rows slide cleanly beneath it. */}
              <p className="sticky top-16 z-10 -mx-4 mb-2 bg-paper/95 px-4 py-2 font-serif text-base text-ink backdrop-blur-sm sm:-mx-6 sm:px-6 md:mx-0 md:bg-card/95 md:px-0">
                {dayHeaderLabel(date)}
              </p>
              <div className="flex flex-col gap-2.5 md:gap-3">
                {items.map((c) => (
                  <ClassRow
                    key={c.id}
                    cls={c}
                    showLocation={showLocationBadge}
                    canBook={canBook}
                    canBookLoaded={canBookLoaded}
                    isSignedIn={!!isSignedIn}
                    entitlements={entitlements}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </BookingSurface>
  );
}
