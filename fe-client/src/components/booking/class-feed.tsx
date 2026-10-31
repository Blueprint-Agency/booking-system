"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { classToBook } from "@/lib/book-return";
import { useMemberSession } from "@/lib/member-auth";
import { useClasses, useLocations, useCanBookClass, type ApiClassCard } from "@/lib/classes";
import { dayHeaderLabel, feedDays, feedWindow } from "@/lib/schedule-days";
import { useStudioZone } from "@/components/brand/brand-provider";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { ClassRow, FilterSelect } from "@/components/booking/class-row";
import { ScheduleSegments } from "@/components/booking/schedule-segments";
import { OneOpenAccordion } from "@/components/booking/one-open-accordion";
import { ContentLoading } from "@/components/ui/content-loading";
import { useHoldLoader } from "@/lib/loading-store";
import { Select } from "@/components/ui/select";
import { BTN_SECONDARY, CARD } from "@/components/ui/styles";
import { ComingUp } from "@/components/account/coming-up";
import { PolicyNotice } from "@/components/booking/policy-notice";
import { StickyFilters } from "@/components/ui/sticky-filters";
import { planHomeLocationId } from "@/lib/package-picker";
import { cn } from "@/lib/utils";
import { useCancellationPolicyRead } from "@/lib/cancellation-policy";
import { classPolicyPoints } from "@/lib/cancellation-copy";

/** Today and the nine days after it. */
const WINDOW_DAYS = 10;

export function ClassFeed() {
  const [selectedLocation, setSelectedLocation] = useState("");
  const [instructor, setInstructor] = useState("");
  // A class this page was sent to book (`?book=`), after a signed-out Book
  // Now and the sign-in it led to: its day opens and its Book sheet with it.
  // Read from the address once, in the browser.
  const router = useRouter();
  const [toBook, setToBook] = useState<string | null>(null);
  useEffect(() => {
    setToBook(classToBook(new URLSearchParams(window.location.search)));
  }, []);
  const bookHandled = useCallback(() => {
    setToBook(null);
    // Off the address too, so a reload or Back does not open it again.
    router.replace("/", { scroll: false });
  }, [router]);

  const tz = useStudioZone();
  const nowMs = useMemo(() => Date.now(), []);
  const { from, to } = useMemo(() => feedWindow(tz, nowMs, WINDOW_DAYS), [tz, nowMs]);

  // `?? []` and not a default argument: the hook returns null while loading,
  // and a default only fires for undefined.
  const { data: locationData } = useLocations();
  const locations = useMemo(() => locationData ?? [], [locationData]);
  const { isLoaded: sessionLoaded, isSignedIn } = useMemberSession();
  const { canBook, loaded: canBookLoaded, entitlements } = useCanBookClass();
  // The schedule is one Location's: two studios' classes side by side read as
  // repeats and get booked at the wrong one. A member whose Unlimited Plans all
  // pay only at one studio opens on that one; anyone else on the first. The
  // feed waits for the list, and for a signed-in member's plans, rather than
  // show one studio and then jump to another.
  const homeId = planHomeLocationId(entitlements?.unlimited_plans);
  const home = locations.find((l) => l.id === homeId)?.id;
  const locationId = selectedLocation || home || locations[0]?.id || "";
  const plansKnown = sessionLoaded && (!isSignedIn || canBookLoaded);
  const { data: classes, loading, refresh } = useClasses(
    { from, to, location_id: locationId || undefined },
    { enabled: locationData !== null && plansKnown },
  );
  // A signed-in member's next-booking ticket lands above the rows once the
  // session is known: the page waits for that rather than be pushed down.
  useHoldLoader(!sessionLoaded);
  // The policy notice sits above the rows: the feed waits for it rather than
  // be pushed down when it lands.
  const { policy, settled: policySettled } = useCancellationPolicyRead();

  // The feed is read without the instructor filter and narrowed here, so the
  // instructor choice lists everyone teaching in the window (at the picked
  // Location) whichever one is picked, and the member can switch straight to
  // another. Like the server's `instructor_id` filter, this matches the main
  // instructor.
  const unfiltered = useMemo(() => classes ?? [], [classes]);
  const all = useMemo(
    () => (instructor ? unfiltered.filter((c) => c.instructor.id === instructor) : unfiltered),
    [unfiltered, instructor],
  );

  const instructorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of unfiltered) seen.set(c.instructor.id, c.instructor.name);
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [unfiltered]);

  const groups = useMemo(() => feedDays(all, nowMs, tz), [all, nowMs, tz]);

  // One day open at a time, the soonest day with classes first.
  const sections = useMemo(
    () =>
      groups.map(({ date, items }) => ({
        key: date,
        label: dayHeaderLabel(date, tz, nowMs),
        summary: `${items.length} ${items.length === 1 ? "class" : "classes"}`,
      })),
    [groups, tz, nowMs],
  );
  const itemsByDate = useMemo(() => new Map(groups.map((g) => [g.date, g.items])), [groups]);
  const bookDay = toBook ? (groups.find((g) => g.items.some((c) => c.id === toBook))?.date ?? null) : null;
  // A class that is not on this schedule (gone, started, another Location's)
  // has no sheet to open: forget it rather than open one later by surprise.
  useEffect(() => {
    if (toBook && classes && !loading && !bookDay) bookHandled();
  }, [toBook, classes, loading, bookDay, bookHandled]);

  const filtered = Boolean(instructor);
  const clearFilters = () => setInstructor("");

  return (
    <BookingSurface>
      <PageHeader title="Schedule" />
      <ScheduleSegments />
      {/* A signed-in member's next booking, its check-in QR and its
          Cancel — the same ticket "Your bookings" leads with. */}
      <ComingUp variant="schedule" onChanged={refresh} />

      <StickyFilters className="mb-3">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select
            ariaLabel="Location"
            value={locationId}
            onChange={setSelectedLocation}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            className="min-w-0 flex-1 sm:max-w-[240px]"
            triggerClassName="border-accent/40 font-medium"
          />
          <FilterSelect
            label="Instructor"
            value={instructor}
            onChange={setInstructor}
            options={instructorOptions}
            placeholder="All instructors"
          />
        </div>
      </StickyFilters>

      {/* The rules a member agrees to by booking, stated before they do. Left
          out rather than guessed while the studio's policy is still loading. */}
      {policy && <PolicyNotice title="Cancellation policy" points={classPolicyPoints(policy)} className="mb-6" />}

      {loading || !policySettled ? (
        <ContentLoading label="Loading schedule" />
      ) : groups.length === 0 ? (
        <div className={cn(CARD, "px-6 py-12 text-center")}>
          <p className="font-semibold text-ink">
            {filtered ? "No classes match this instructor" : "No classes scheduled yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? "Try another instructor or location."
              : `Classes for the next ${WINDOW_DAYS} days show up here.`}
          </p>
          {filtered && (
            <button type="button" onClick={clearFilters} className={cn(BTN_SECONDARY, "mt-5")}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <OneOpenAccordion sections={sections} idPrefix="day" initialKey={bookDay}>
          {(date) => (
            <div className={cn(CARD, "divide-y divide-ink/5")}>
              {(itemsByDate.get(date) ?? []).map((c) => (
                <ClassRow
                  key={c.id}
                  cls={c}
                  showLocation={!locationId}
                  canBook={canBook}
                  canBookLoaded={canBookLoaded}
                  isSignedIn={!!isSignedIn}
                  entitlements={entitlements}
                  onStale={refresh}
                  autoBook={c.id === toBook}
                  onAutoBooked={bookHandled}
                />
              ))}
            </div>
          )}
        </OneOpenAccordion>
      )}
    </BookingSurface>
  );
}
