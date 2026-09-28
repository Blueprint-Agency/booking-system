"use client";

import { useMemo, useState } from "react";
import { useMemberSession } from "@/lib/member-auth";
import { useClasses, useLocations, useCanBookClass, toLocalDateStr, type ApiClassCard } from "@/lib/classes";
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
import { cn } from "@/lib/utils";
import { useCancellationPolicyRead } from "@/lib/cancellation-policy";
import { classPolicyPoints } from "@/lib/cancellation-copy";

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

  // `?? []` and not a default argument: the hook returns null while loading,
  // and a default only fires for undefined.
  const { data: locationData } = useLocations();
  const locations = useMemo(() => locationData ?? [], [locationData]);
  // The schedule is one Location's: two studios' classes side by side read as
  // repeats and get booked at the wrong one. It opens on the first Location,
  // and the feed waits for the list rather than showing every studio first.
  const locationId = selectedLocation || locations[0]?.id || "";
  const { data: classes, loading, refresh } = useClasses(
    { from, to, location_id: locationId || undefined },
    { enabled: locationData !== null },
  );
  const { isLoaded: sessionLoaded, isSignedIn } = useMemberSession();
  // A signed-in member's next-booking ticket lands above the rows once the
  // session is known: the page waits for that rather than be pushed down.
  useHoldLoader(!sessionLoaded);
  // The policy notice sits above the rows: the feed waits for it rather than
  // be pushed down when it lands.
  const { policy, settled: policySettled } = useCancellationPolicyRead();
  const { canBook, loaded: canBookLoaded, entitlements } = useCanBookClass();

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

  // One day open at a time, the soonest day with classes first.
  const sections = useMemo(
    () =>
      groups.map(({ date, items }) => ({
        key: date,
        label: dayHeaderLabel(date),
        summary: `${items.length} ${items.length === 1 ? "class" : "classes"}`,
      })),
    [groups],
  );
  const itemsByDate = useMemo(() => new Map(groups.map((g) => [g.date, g.items])), [groups]);

  const filtered = Boolean(instructor);
  const clearFilters = () => setInstructor("");

  return (
    <BookingSurface>
      <PageHeader title="Schedule" />
      <ScheduleSegments />
      {/* A signed-in member's next booking, its check-in QR (#192) and its
          Cancel — the same ticket "Your bookings" leads with. */}
      <ComingUp variant="schedule" onChanged={refresh} />

      <div className="grid grid-cols-2 gap-2 mb-3 sm:flex">
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
        <OneOpenAccordion sections={sections} idPrefix="day">
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
                />
              ))}
            </div>
          )}
        </OneOpenAccordion>
      )}
    </BookingSurface>
  );
}
