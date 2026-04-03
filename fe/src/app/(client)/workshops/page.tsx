"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatDate, formatTime } from "@/lib/utils";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";

const typedSessions = sessionsData as Session[];
const typedInstructors = instructorsData as Instructor[];

// Tenant-1 workshops and events, sorted soonest first
const WORKSHOPS = typedSessions
  .filter((s) => s.tenantId === "tenant-1" && (s.type === "workshop" || s.type === "event"))
  .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

const TODAY = new Date("2026-04-03");

function getInstructor(id: string): Instructor | undefined {
  return typedInstructors.find((i) => i.id === id);
}

function WorkshopCard({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const instructor = getInstructor(session.instructorId);
  const instructorName = instructor?.name ?? "Instructor";

  const sessionDate = new Date(session.date + "T00:00:00");
  const isPast = sessionDate < TODAY;
  const isFull = session.bookedCount >= session.capacity;
  const isDisabled = isPast || isFull;
  const spotsLeft = session.capacity - session.bookedCount;

  const levelColors: Record<string, string> = {
    beginner: "bg-sage-light text-sage border-sage/20",
    intermediate: "bg-warning-bg text-warning border-warning/20",
    advanced: "bg-error-bg text-error border-error/20",
    all: "bg-accent-glow/30 text-accent-deep border-accent/20",
  };

  return (
    <div className={cn(
      "bg-card border border-border rounded-xl overflow-hidden transition-shadow",
      open && "shadow-hover"
    )}>
      {/* Card header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-4 p-5 text-left hover:bg-warm/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={cn("text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border", levelColors[session.level] ?? levelColors.all)}>
              {session.level === "all" ? "All levels" : session.level}
            </span>
            {session.type === "event" && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-info-bg text-info border border-info/20">
                Community event
              </span>
            )}
            {isPast && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-warm text-muted border border-border">
                Ended
              </span>
            )}
            {isFull && !isPast && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-error-bg text-error border border-error/20">
                Full
              </span>
            )}
          </div>
          <h3 className="font-serif text-lg text-ink">{session.name}</h3>
          <p className="text-sm text-muted mt-0.5">{formatDate(session.date)} · {formatTime(session.time)} · {session.duration} min</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-base font-semibold text-ink">
            {session.price === 0 ? "Free" : `S$${session.price}`}
          </span>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={cn("text-muted transition-transform duration-200", open && "rotate-180")}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Expandable detail */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-5 bg-warm/30 space-y-5">
              {/* Description */}
              <p className="text-sm text-muted leading-relaxed">{session.description}</p>

              {/* Details grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Instructor</p>
                  <div className="flex items-center gap-2">
                    {instructor?.avatarUrl && (
                      <img src={instructor.avatarUrl} alt={instructorName} className="w-6 h-6 rounded-full object-cover" />
                    )}
                    <span className="text-sm font-medium text-ink">{instructorName}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Capacity</p>
                  <p className="text-sm font-medium text-ink">
                    {spotsLeft > 0 ? `${spotsLeft} of ${session.capacity} spots left` : "Full"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Duration</p>
                  <p className="text-sm font-medium text-ink">{session.duration} minutes</p>
                </div>
              </div>

              {/* Package row */}
              <div className="border-t border-border pt-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Package</p>
                    <p className="font-serif text-lg text-ink">
                      {session.price === 0 ? "Free — no payment needed" : `S$${session.price} per person`}
                    </p>
                    {session.price > 0 && (
                      <p className="text-xs text-muted mt-0.5">
                        {session.packageEligible ? "Credits accepted" : "Direct payment only"}
                      </p>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="flex flex-col gap-2 sm:items-end">
                    {isDisabled ? (
                      <>
                        <button
                          disabled
                          className="px-5 py-2.5 text-sm font-medium bg-warm text-muted rounded-md border border-border cursor-not-allowed"
                        >
                          {isPast ? "Workshop Ended" : "Fully Enrolled"}
                        </button>
                        {isFull && !isPast && session.waitlistEnabled && (
                          <button className="text-sm text-accent hover:text-accent-deep transition-colors underline underline-offset-2">
                            Join waitlist
                          </button>
                        )}
                      </>
                    ) : (
                      <Link
                        href={`/workshops/${session.id}`}
                        className="px-5 py-2.5 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors text-center"
                      >
                        Purchase
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function WorkshopsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-ink mb-2">Workshops</h1>
        <p className="text-sm text-muted max-w-xl">
          Specialised sessions that go deeper. One-time events with limited spots — book early to secure your place.
        </p>
      </div>

      {WORKSHOPS.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted">No upcoming workshops at the moment. Check back soon.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {WORKSHOPS.map((session, i) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
            >
              <WorkshopCard session={session} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
