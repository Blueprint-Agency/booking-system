"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatTime, getTenantLocations, getLocationName } from "@/lib/utils";
import { LocationFilter } from "@/components/location-filter";
import { MOCK_USER } from "@/data/mock-user";
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
        "h-full py-1.5 flex flex-col gap-2",
        isFull && "opacity-60"
      )}>
        {/* Content — grows to fill cell height */}
        <div className="flex-1 flex flex-col gap-2">
          {/* Tag + duration row */}
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-accent-deep bg-accent-glow/30 px-1.5 py-0.5 rounded-full border border-accent/20 leading-none">
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
          <p className="text-xs text-muted">{getInstructorName(session.instructorId)}</p>

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

          {/* Location badge */}
          {showLocation && locationName && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted/70 bg-warm px-1.5 py-0.5 rounded border border-border w-fit">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              {locationName}
            </span>
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
        </div>

        {/* CTA — always pinned to bottom */}
        {isFull ? (
          session.waitlistEnabled ? (
            <Link
              href={`/booking/confirmation?type=class&session=${session.id}`}
              className="w-full text-center text-xs py-2 bg-warning-bg text-warning border border-warning/30 rounded-lg hover:bg-warning/10 transition-colors"
            >
              Join Waitlist
            </Link>
          ) : (
            <div className="w-full text-center text-xs py-2 text-muted bg-warm rounded-lg border border-border">
              Full
            </div>
          )
        ) : canBook ? (
          <Link
            href={`/booking/confirmation?type=class&session=${session.id}`}
            className="w-full text-center text-xs py-2 bg-accent text-white rounded-lg hover:bg-accent-deep transition-colors font-medium"
          >
            Book
          </Link>
        ) : (
          <button
            onClick={() => setShowDialog(true)}
            className="w-full text-xs py-2 bg-warm text-muted/70 rounded-lg border border-border hover:bg-border/40 transition-colors cursor-pointer"
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
              <div className="w-12 h-12 rounded-full bg-warning-bg flex items-center justify-center mx-auto mb-4">
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
    <div className="flex-1 flex items-start justify-center pt-6">
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

  // Mobile: default-expand today if in view, else first day
  const defaultExpanded = todayIndex !== -1 ? todayIndex : 0;
  const [expandedDay, setExpandedDay] = useState<number | null>(defaultExpanded);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="font-serif text-3xl text-ink">Classes</h1>
          <p className="text-sm text-muted mt-0.5">Book group yoga classes using your credits.</p>
        </div>

        {/* Credit balance badge */}
        {userHasCredits ? (
          <Link href="/account/packages" className="group self-start">
            <div className="px-4 py-2.5 bg-sage-light border border-sage/20 rounded-xl text-sm group-hover:border-sage/40 transition-colors">
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
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent-deep transition-colors self-start"
          >
            Buy a Package
          </Link>
        )}
      </div>

      {/* Location filter */}
      <div className="mb-6">
        <LocationFilter
          locations={TENANT_LOCATIONS}
          selected={selectedLocation}
          onChange={setSelectedLocation}
        />
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          className="flex items-center justify-center w-9 h-9 text-muted border border-border rounded-lg hover:text-ink hover:bg-warm transition-colors flex-shrink-0"
          aria-label="Previous week"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="flex-1 flex items-center justify-center gap-2">
          <span className="text-sm font-medium text-ink">{monthLabel}</span>
          {!weekContainsToday && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-[11px] font-mono text-accent border border-accent/30 px-2 py-0.5 rounded-full hover:bg-accent-glow/20 transition-colors"
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ── Desktop: calendar grid ─────────────────────── */}
      <div className="hidden lg:block border border-border rounded-xl overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-7 border-b border-border bg-warm">
          {weekDays.map((day, di) => {
            const isToday = toDateStr(day) === TODAY_STR;
            const showMonth = di === 0 || day.getDate() === 1;
            return (
              <div
                key={di}
                className={cn(
                  "text-center py-3 px-2 border-r last:border-r-0 border-border",
                  isToday && "bg-accent"
                )}
              >
                <p className={cn(
                  "text-[10px] font-mono uppercase tracking-widest",
                  isToday ? "text-white/70" : "text-muted"
                )}>
                  {DAY_LABELS[di]}
                </p>
                <p className={cn(
                  "text-lg font-semibold leading-none mt-1",
                  isToday ? "text-white" : "text-ink"
                )}>
                  {day.getDate()}
                </p>
                <p className={cn(
                  "text-[10px] font-mono mt-1",
                  isToday ? "text-white/60" : "text-muted/60"
                )}>
                  {showMonth ? MONTH_NAMES[day.getMonth()] : ""}
                </p>
              </div>
            );
          })}
        </div>

        {/* Session rows — one row per slot so columns align */}
        {(() => {
          const allSessions = weekDays.map((d) => getSessionsForDay(d, filteredSessions));
          const maxSlots = Math.max(...allSessions.map((s) => s.length), 1);
          return Array.from({ length: maxSlots }, (_, rowIdx) => (
            <div key={rowIdx} className="grid grid-cols-7 border-t border-border bg-card">
              {weekDays.map((day, di) => {
                const sessions = allSessions[di];
                const session = sessions[rowIdx];
                const isToday = toDateStr(day) === TODAY_STR;
                return (
                  <div
                    key={di}
                    className={cn(
                      "border-r last:border-r-0 border-border p-3",
                      isToday && "bg-accent/[0.03]"
                    )}
                  >
                    {session ? (
                      <ClassCard session={session} showLocation={showLocationBadge} />
                    ) : (
                      <div className="h-full" />
                    )}
                  </div>
                );
              })}
            </div>
          ));
        })()}
      </div>

      {/* ── Mobile: accordion per day ─────────────────── */}
      <div className="lg:hidden space-y-1.5">
        {weekDays.map((day, di) => {
          const sessions = getSessionsForDay(day, filteredSessions);
          const isToday = toDateStr(day) === TODAY_STR;
          const isOpen = expandedDay === di;
          const sessionCount = sessions.length;

          return (
            <div key={di} className={cn(
              "border rounded-xl overflow-hidden",
              isToday ? "border-accent/30" : "border-border"
            )}>
              <button
                onClick={() => setExpandedDay(isOpen ? null : di)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3.5 transition-colors",
                  isToday ? "bg-accent/5 hover:bg-accent/8" : "bg-card hover:bg-warm"
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Date circle */}
                  <div className={cn(
                    "w-9 h-9 rounded-full flex flex-col items-center justify-center flex-shrink-0",
                    isToday ? "bg-accent text-white" : "bg-warm text-ink"
                  )}>
                    <span className="text-[9px] font-mono uppercase leading-none opacity-70">{DAY_LABELS[di]}</span>
                    <span className="text-sm font-semibold leading-tight">{day.getDate()}</span>
                  </div>

                  <div className="flex flex-col items-start">
                    <span className={cn(
                      "text-sm font-medium leading-tight",
                      isToday ? "text-accent-deep" : "text-ink"
                    )}>
                      {DAY_LABELS_FULL[di]}
                      {isToday && <span className="ml-1.5 text-[10px] font-mono text-accent bg-accent-glow/40 px-1.5 py-0.5 rounded-full">today</span>}
                    </span>
                    <span className="text-xs text-muted">
                      {sessionCount === 0 ? "No classes" : `${sessionCount} class${sessionCount !== 1 ? "es" : ""}`}
                    </span>
                  </div>
                </div>

                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                  className={cn("text-muted transition-transform duration-200 flex-shrink-0", isOpen && "rotate-180")}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 space-y-3 bg-warm border-t border-border">
                      {sessions.length === 0 ? (
                        <p className="text-sm text-muted text-center py-6">No classes scheduled</p>
                      ) : (
                        sessions.map((s) => (
                          <div key={s.id} className="bg-card border border-border rounded-lg p-3.5">
                            <ClassCard session={s} showLocation={showLocationBadge} />
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
