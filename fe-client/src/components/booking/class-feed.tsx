"use client";

import { useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useClasses, useLocations, useCanBookClass, toLocalDateStr, type ApiClassCard } from "@/lib/classes";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { ClassRow, FilterSelect } from "@/components/booking/class-row";
import { ScheduleSegments } from "@/components/booking/schedule-segments";
import { Skeleton } from "@/components/ui/skeleton";

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
  const { data: locations } = useLocations();
  const { isSignedIn } = useUser();
  const { canBook, loaded: canBookLoaded } = useCanBookClass();

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

  return (
    <BookingSurface maxWidth="xl" padding="default">
      <SectionHeading
        eyebrow="Yoga Sadhana · Tai Seng & Outram Park"
        title="Book a class"
        description="All upcoming classes across both studios — book your spot."
      />
      <ScheduleSegments />

      <div className="flex flex-wrap gap-2 mb-6">
        <FilterSelect
          value={selectedLocation}
          onChange={setSelectedLocation}
          options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))}
          placeholder="All locations"
        />
        <FilterSelect value={instructor} onChange={setInstructor} options={instructorOptions} placeholder="All instructors" />
      </div>

      {loading ? (
        <div className="flex flex-col gap-3" aria-label="Loading schedule">
          <Skeleton className="h-5 w-40 mb-1" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted">No upcoming classes in the next {WINDOW_DAYS} days.</div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(({ date, items }) => (
            <div key={date}>
              <p className="font-serif text-base text-ink mb-3 sticky top-16 bg-paper/95 backdrop-blur-sm py-1 z-10">
                {dayHeaderLabel(date)}
              </p>
              <div className="flex flex-col gap-3">
                {items.map((c) => (
                  <ClassRow
                    key={c.id}
                    cls={c}
                    showLocation={showLocationBadge}
                    canBook={canBook}
                    canBookLoaded={canBookLoaded}
                    isSignedIn={!!isSignedIn}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </BookingSurface>
  );
}
