"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatTime } from "@/lib/utils";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";

const typedSessions = sessionsData as Session[];
const typedInstructors = instructorsData as Instructor[];

// Only show tenant-1 regular (non-cancelled) sessions in the calendar
const YOGA_SESSIONS = typedSessions.filter(
  (s) => s.tenantId === "tenant-1" && s.type === "regular"
);

// Mock user state: has a Bundle of 10, 8 credits remaining
const USER_CREDITS = 8;
const USER_PACKAGE = "Bundle of 10";
const userHasCredits = USER_CREDITS > 0;

// Week starting Monday Apr 7, 2026 (where all prototype data lives)
const BASE_MONDAY = new Date(2026, 3, 7); // month is 0-indexed

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

function getSessionsForDay(date: Date): Session[] {
  const ds = toDateStr(date);
  return YOGA_SESSIONS.filter((s) => s.date === ds && s.status !== "cancelled").sort((a, b) =>
    a.time.localeCompare(b.time)
  );
}

function getInstructorName(id: string): string {
  return typedInstructors.find((i) => i.id === id)?.name ?? "Instructor";
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ClassCard({ session }: { session: Session }) {
  const [showDialog, setShowDialog] = useState(false);
  const isFull = session.bookedCount >= session.capacity;
  const spotsLeft = session.capacity - session.bookedCount;

  const canBook = userHasCredits && !isFull;

  return (
    <>
      <div className={cn(
        "bg-card border rounded-lg p-3 flex flex-col gap-2.5 transition-shadow",
        canBook ? "border-border hover:shadow-soft" : "border-border",
      )}>
        {/* Tag */}
        <span className="self-start text-[10px] font-mono uppercase tracking-wider text-accent-deep bg-accent-glow/30 px-2 py-0.5 rounded-full">
          {session.category}
        </span>

        {/* Title */}
        <h4 className="font-serif text-sm text-ink leading-snug">{session.name}</h4>

        {/* Instructor + Time */}
        <div className="space-y-0.5">
          <p className="text-xs text-muted">{getInstructorName(session.instructorId)}</p>
          <p className="text-xs text-muted">{formatTime(session.time)} · {session.duration} min</p>
        </div>

        {/* Credits info */}
        {isFull ? (
          <p className="text-xs text-error font-medium">Class full</p>
        ) : (
          <div className="text-xs text-sage leading-relaxed">
            {userHasCredits ? (
              <>
                <p>1 credit required</p>
                <p>You have {USER_CREDITS} credits left</p>
              </>
            ) : (
              <p className="text-muted">Purchase a package to book</p>
            )}
          </div>
        )}

        {/* Book Now button */}
        {isFull ? (
          session.waitlistEnabled ? (
            <Link
              href="/booking/confirmation"
              className="w-full text-center text-xs py-2 bg-warning-bg text-warning border border-warning/20 rounded-md hover:bg-warning/10 transition-colors"
            >
              Join Waitlist
            </Link>
          ) : (
            <button
              disabled
              className="w-full text-xs py-2 bg-warm text-muted rounded-md cursor-not-allowed"
            >
              Full
            </button>
          )
        ) : canBook ? (
          <Link
            href="/booking/confirmation"
            className="w-full text-center text-xs py-2 bg-accent text-white rounded-md hover:bg-accent-deep transition-colors"
          >
            Book Now
          </Link>
        ) : (
          <button
            onClick={() => setShowDialog(true)}
            className="w-full text-xs py-2 bg-warm text-muted/70 rounded-md border border-border hover:bg-border/40 transition-colors cursor-pointer"
          >
            Book Now
          </button>
        )}

        {/* Spots indicator */}
        {!isFull && spotsLeft <= 3 && (
          <p className="text-[10px] text-warning text-center">Only {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left</p>
        )}
      </div>

      {/* No-credits dialog */}
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
              You need an active package to book classes. Purchase a credit bundle or unlimited plan to get started.
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
    </>
  );
}

function EmptyDay() {
  return (
    <div className="border border-dashed border-border rounded-lg p-4 text-center">
      <p className="text-xs text-muted/50">No classes</p>
    </div>
  );
}

export default function ClassesPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = getWeekStart(weekOffset);
  const weekDays = getWeekDays(monday);
  const sunday = weekDays[6];

  const weekLabel = `${DAY_LABELS[0]} ${MONTH_NAMES[monday.getMonth()]} ${monday.getDate()} – ${DAY_LABELS[6]} ${MONTH_NAMES[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;

  // For mobile: track expanded day
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl text-ink mb-1">Classes</h1>
          <p className="text-sm text-muted">Book group yoga classes using your credits.</p>
        </div>

        {/* Credit balance badge */}
        {userHasCredits ? (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-sage-light border border-sage/20 rounded-lg text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sage">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-sage font-medium">{USER_CREDITS} credits</span>
            <span className="text-muted text-xs">· {USER_PACKAGE}</span>
          </div>
        ) : (
          <Link
            href="/packages"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-deep transition-colors"
          >
            Buy a Package
          </Link>
        )}
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted border border-border rounded-md hover:text-ink hover:bg-warm transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Prev
        </button>
        <span className="text-sm font-medium text-ink">{weekLabel}</span>
        <button
          onClick={() => setWeekOffset((o) => o + 1)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted border border-border rounded-md hover:text-ink hover:bg-warm transition-colors"
        >
          Next
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ── Desktop: 7-column grid ─────────────────────── */}
      <div className="hidden lg:grid grid-cols-7 gap-3">
        {weekDays.map((day, di) => {
          const sessions = getSessionsForDay(day);
          const isToday = toDateStr(day) === "2026-04-03";
          return (
            <div key={di} className="flex flex-col gap-2">
              {/* Day header */}
              <div className={cn(
                "text-center py-2 rounded-md",
                isToday ? "bg-accent-glow/30" : ""
              )}>
                <p className={cn("text-xs font-mono uppercase tracking-wider", isToday ? "text-accent-deep" : "text-muted")}>
                  {DAY_LABELS[di]}
                </p>
                <p className={cn("text-sm font-semibold mt-0.5", isToday ? "text-accent" : "text-ink")}>
                  {day.getDate()}
                </p>
              </div>
              {/* Sessions */}
              {sessions.length === 0 ? (
                <EmptyDay />
              ) : (
                sessions.map((s) => <ClassCard key={s.id} session={s} />)
              )}
            </div>
          );
        })}
      </div>

      {/* ── Mobile: accordion per day ─────────────────── */}
      <div className="lg:hidden space-y-2">
        {weekDays.map((day, di) => {
          const sessions = getSessionsForDay(day);
          const isOpen = expandedDay === di;
          return (
            <div key={di} className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedDay(isOpen ? null : di)}
                className="w-full flex items-center justify-between px-5 py-4 bg-card hover:bg-warm transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-ink">{DAY_LABELS[di]}, {MONTH_NAMES[day.getMonth()]} {day.getDate()}</span>
                  {sessions.length > 0 && (
                    <span className="text-xs bg-accent-glow/30 text-accent-deep px-2 py-0.5 rounded-full font-mono">
                      {sessions.length} class{sessions.length !== 1 ? "es" : ""}
                    </span>
                  )}
                </div>
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                  className={cn("text-muted transition-transform duration-200", isOpen && "rotate-180")}
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
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 space-y-3 bg-warm border-t border-border">
                      {sessions.length === 0 ? (
                        <p className="text-sm text-muted text-center py-4">No classes scheduled</p>
                      ) : (
                        sessions.map((s) => <ClassCard key={s.id} session={s} />)
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
