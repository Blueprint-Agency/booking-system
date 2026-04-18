"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, formatTime, getTenantLocations, getLocationName } from "@/lib/utils";
import { LocationFilter } from "@/components/location-filter";
import { MOCK_USER } from "@/data/mock-user";
import { CtaBanner } from "@/components/marketing/cta-banner";
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

const USER_CREDITS = MOCK_USER.classCredits;
const USER_PACKAGE = MOCK_USER.classPackageName;
const userHasCredits = USER_CREDITS > 0;

const BASE_MONDAY = new Date(2026, 3, 7);
const TODAY_STR = "2026-04-03";

function getWeekStart(offset: number): Date {
  const d = new Date(BASE_MONDAY);
  d.setDate(d.getDate() + offset * 7);
  return d;
}

function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getSessionsForDay(date: Date, sessions: Session[]): Session[] {
  const ds = toDateStr(date);
  return sessions.filter((s) => s.date === ds && s.status !== "cancelled").sort((a, b) =>
    a.time.localeCompare(b.time)
  );
}

function getInstructorName(id: string): string {
  return typedInstructors.find((i) => i.id === id)?.name ?? "Instructor";
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LABELS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ClassCard({ session, showLocation }: { session: Session; showLocation: boolean }) {
  const [showDialog, setShowDialog] = useState(false);
  const isFull = session.bookedCount >= session.capacity;
  const canBook = userHasCredits && !isFull;
  const locationName = getLocationName(session.locationId);

  return (
    <>
      <div className={cn(
        "rounded-2xl border border-ink/10 bg-paper p-4 hover:shadow-hover hover:-translate-y-0.5 transition-all flex flex-col gap-2",
        isFull && "opacity-60"
      )}>
        {/* Tag + duration row */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-accent-deep bg-cyan/15 px-1.5 py-0.5 rounded-full border border-accent/20 leading-none">
            {session.category}
          </span>
          <span className="text-[11px] text-muted font-mono">{session.duration}m</span>
        </div>

        {/* Time */}
        <span className={cn(
          "text-[15px] font-semibold tracking-tight",
          isFull ? "text-muted" : "text-ink"
        )}>
          {formatTime(session.time)}
        </span>

        {/* Class name */}
        <h4 className={cn(
          "font-serif text-[15px] leading-snug",
          isFull ? "text-muted" : "text-ink"
        )}>
          {session.name}
        </h4>

        {/* Instructor */}
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-warm shrink-0" />
          <p className="text-xs text-muted">{getInstructorName(session.instructorId)}</p>
        </div>

        {/* Duration + location chips */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] font-mono text-muted/70 bg-warm px-1.5 py-0.5 rounded border border-border">
            {session.duration} min
          </span>
          {showLocation && locationName && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted/70 bg-warm px-1.5 py-0.5 rounded border border-border">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              {locationName}
            </span>
          )}
        </div>

        {/* Dynamic credit text */}
        {!isFull && (
          <p className="text-[11px] text-muted/80 leading-snug">
            <span className="text-sage font-medium">1 credit</span>
            {" · "}
            {MOCK_USER.classPackageUnlimited
              ? <span className="text-sage">unlimited credits</span>
              : userHasCredits
                ? <span>{USER_CREDITS} left</span>
                : <span className="text-error">no credits</span>
            }
          </p>
        )}

        {/* Description — truncated with hover popover */}
        {session.description && (
          <div className="relative group/desc">
            <p className="text-[11px] text-muted/70 leading-relaxed line-clamp-2 cursor-help">{session.description}</p>
            <div className="absolute left-0 bottom-full mb-1.5 w-64 p-3 bg-ink text-white text-[11px] leading-relaxed rounded-lg shadow-lg opacity-0 invisible group-hover/desc:opacity-100 group-hover/desc:visible transition-all duration-200 z-30 pointer-events-none">
              {session.description}
              <div className="absolute left-4 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-ink" />
            </div>
          </div>
        )}

        {/* CTA — pinned to bottom */}
        {isFull ? (
          session.waitlistEnabled ? (
            <Link
              href={`/booking/confirmation?type=class&session=${session.id}`}
              className="w-full text-center text-xs py-2 bg-warning/15 text-warning border border-warning/30 rounded-lg hover:bg-warning/10 transition-colors mt-auto"
            >
              Join Waitlist
            </Link>
          ) : (
            <div className="w-full text-center text-xs py-2 text-muted bg-warm rounded-lg border border-border mt-auto">
              Full
            </div>
          )
        ) : canBook ? (
          <Link
            href={`/booking/confirmation?type=class&session=${session.id}`}
            className="w-full text-center text-xs py-2 bg-accent text-white rounded-lg hover:bg-accent-deep transition-colors font-medium mt-auto"
          >
            Book
          </Link>
        ) : (
          <button
            onClick={() => setShowDialog(true)}
            className="w-full text-xs py-2 bg-warm text-muted/70 rounded-lg border border-border hover:bg-border/40 transition-colors cursor-pointer mt-auto"
          >
            Book
          </button>
        )}
      </div>

      {/* No-credits dialog */}
      <AnimatePresence>
        {showDialog && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm"
            onClick={() => setShowDialog(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-card rounded-xl p-6 max-w-sm w-full mx-4 shadow-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-full bg-warning/15 flex items-center justify-center mx-auto mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h3 className="font-serif text-lg text-ink text-center mb-2">Package required</h3>
              <p className="text-sm text-muted text-center mb-6">
                You must purchase a package to book a class. Choose a credit bundle or unlimited plan to get started.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDialog(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-muted border border-border rounded-md hover:bg-warm transition-colors"
                >
                  Cancel
                </button>
                <Link
                  href="/packages"
                  className="flex-1 text-center px-4 py-2.5 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                >
                  Buy a Package
                </Link>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function EmptyDay() {
  return (
    <div className="flex items-start justify-center pt-6">
      <p className="text-[11px] text-muted/40 font-mono">—</p>
    </div>
  );
}

// Find which weekday index "today" falls on within the displayed week
function getTodayDayIndex(weekDays: Date[]): number {
  return weekDays.findIndex((d) => toDateStr(d) === TODAY_STR);
}

export default function ClassesPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedLocation, setSelectedLocation] = useState<string | "all">("all");
  const monday = getWeekStart(weekOffset);
  const weekDays = getWeekDays(monday);
  const sunday = weekDays[6];

  const filteredSessions = selectedLocation === "all"
    ? ALL_YOGA_SESSIONS
    : ALL_YOGA_SESSIONS.filter((s) => s.locationId === selectedLocation);
  const showLocationBadge = selectedLocation === "all";

  const todayIndex = getTodayDayIndex(weekDays);
  const weekContainsToday = todayIndex !== -1;

  // Month range label — "7–13 April 2026" or "28 April – 4 May 2026"
  const startMonth = MONTH_NAMES[monday.getMonth()];
  const endMonth = MONTH_NAMES[sunday.getMonth()];
  const weekYear = sunday.getFullYear();
  const monthLabel = startMonth === endMonth
    ? `${monday.getDate()}–${sunday.getDate()} ${startMonth} ${weekYear}`
    : `${monday.getDate()} ${startMonth} – ${sunday.getDate()} ${endMonth} ${weekYear}`;


  return (
    <>
      {/* 2. Booking Surface — weekly calendar */}
      <div id="schedule">
      <BookingSurface maxWidth="xl" padding="default">
        <SectionHeading
          eyebrow="Schedule"
          title="Weekly view"
          description="Switch weeks with the arrows below."
        />

        {/* Credit balance badge */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="w-full">
            <LocationFilter
              locations={TENANT_LOCATIONS}
              selected={selectedLocation}
              onChange={setSelectedLocation}
            />
          </div>
          {userHasCredits ? (
            <Link href="/account/packages" className="group self-start sm:self-auto shrink-0">
              <div className="px-4 py-2.5 bg-sage/10 border border-sage/20 rounded-xl text-sm group-hover:border-sage/40 transition-colors">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-sage inline-block" />
                  <span className="text-sage font-semibold">{USER_CREDITS} credits</span>
                  <span className="text-muted text-xs">· {USER_PACKAGE}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1 rounded-full bg-sage/20 overflow-hidden">
                    <div className="h-full rounded-full bg-sage" style={{ width: `${(MOCK_USER.classCredits / MOCK_USER.classPackageTotal) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-muted">expires {new Date(MOCK_USER.classPackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</span>
                </div>
              </div>
            </Link>
          ) : (
            <Link
              href="/packages"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent-deep transition-colors self-start sm:self-auto shrink-0"
            >
              Buy a Package
            </Link>
          )}
        </div>

        {/* Week navigation bar */}
        <div className="flex items-center gap-3 border-b border-ink/10 pb-4 mb-6">
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            className="flex items-center justify-center w-9 h-9 text-muted border border-border rounded-lg hover:text-ink hover:bg-warm transition-colors flex-shrink-0"
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="flex-1 flex items-center justify-center gap-2">
            <span className="font-medium text-ink">{monthLabel}</span>
            {!weekContainsToday && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-[11px] font-mono text-accent border border-accent/30 px-2 py-0.5 rounded-full hover:bg-accent/10 transition-colors"
              >
                Today
              </button>
            )}
          </div>

          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="flex items-center justify-center w-9 h-9 text-muted border border-border rounded-lg hover:text-ink hover:bg-warm transition-colors flex-shrink-0"
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Day columns grid */}
        <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
          {weekDays.map((day, di) => {
            const sessions = getSessionsForDay(day, filteredSessions);
            const isToday = toDateStr(day) === TODAY_STR;
            return (
              <div key={di} className="flex flex-col gap-3">
                {/* Day label */}
                <div className={cn(
                  "flex items-center gap-2 md:flex-col md:items-center md:gap-0",
                )}>
                  <p className={cn(
                    "text-[10px] font-mono uppercase tracking-widest",
                    isToday ? "text-accent" : "text-muted"
                  )}>
                    {DAY_LABELS[di]}
                  </p>
                  <div className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold",
                    isToday ? "bg-accent text-white" : "text-ink"
                  )}>
                    {day.getDate()}
                  </div>
                  <p className={cn(
                    "text-[10px] font-mono md:mt-0.5",
                    isToday ? "text-accent/70" : "text-muted/60"
                  )}>
                    {MONTH_NAMES[day.getMonth()]}
                  </p>
                </div>

                {/* Class cards */}
                <div className="flex flex-col gap-2">
                  {sessions.length === 0 ? (
                    <EmptyDay />
                  ) : (
                    sessions.map((session) => (
                      <ClassCard key={session.id} session={session} showLocation={showLocationBadge} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </BookingSurface>
      </div>

      {/* 3. Closing CTA */}
      <CtaBanner
        imageKey="cta-community"
        headline="Can't find a time that works?"
        subheadline="Private 1:1 sessions are available 7 days a week."
        primaryCta={{ href: "/private-sessions", label: "Book 1:1" }}
      />
    </>
  );
}
