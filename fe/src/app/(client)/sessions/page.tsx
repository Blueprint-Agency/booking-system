"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { SessionCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import type { Session, Instructor } from "@/types";
import sessions from "@/data/sessions.json";
import instructors from "@/data/instructors.json";

const typedSessions = sessions as Session[];
const typedInstructors = instructors as Instructor[];

const CATEGORIES = ["All", "Wellness", "Fitness", "Recovery"] as const;
const LEVELS = ["All", "beginner", "intermediate", "advanced", "all"] as const;
const LEVEL_LABELS: Record<string, string> = {
  All: "All Levels",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  all: "Open Level",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6AM - 8PM

const CATEGORY_COLORS: Record<string, string> = {
  Wellness: "bg-accent-glow border-accent text-accent-deep",
  Fitness: "bg-info-bg border-info text-info",
  Recovery: "bg-sage-light border-sage text-sage",
};

function getInstructor(id: string) {
  return typedInstructors.find((i) => i.id === id);
}

function getDayIndex(dateStr: string): number {
  const d = new Date(dateStr);
  // getDay: 0=Sun, adjust so 0=Mon
  return (d.getDay() + 6) % 7;
}

function parseTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}

export default function SessionsPage() {
  const [category, setCategory] = useState("All");
  const [instructorId, setInstructorId] = useState("All");
  const [level, setLevel] = useState("All");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    return typedSessions
      .filter((s) => category === "All" || s.category === category)
      .filter((s) => instructorId === "All" || s.instructorId === instructorId)
      .filter((s) => level === "All" || s.level === level)
      .sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        return a.time.localeCompare(b.time);
      });
  }, [category, instructorId, level]);

  const selectClasses =
    "bg-warm border border-border rounded-md px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors appearance-none cursor-pointer";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-2">
          Sessions
        </h1>
        <p className="text-muted text-sm mb-6">
          Browse and book upcoming classes, workshops, and events.
        </p>
      </motion.div>

      {/* Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mb-6"
      >
        {/* Mobile filter toggle */}
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="md:hidden flex items-center gap-2 px-4 py-2.5 bg-warm border border-border rounded-md text-sm font-medium text-ink mb-3 w-full justify-between"
        >
          <span className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="8" y1="12" x2="20" y2="12" />
              <line x1="12" y1="18" x2="20" y2="18" />
            </svg>
            Filters
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              "transition-transform duration-200",
              filtersOpen && "rotate-180"
            )}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Filter controls */}
        <div
          className={cn(
            "flex flex-col md:flex-row md:items-center gap-3",
            !filtersOpen && "hidden md:flex"
          )}
        >
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            {/* Category */}
            <div className="relative">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectClasses}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c === "All" ? "All Categories" : c}
                  </option>
                ))}
              </select>
            </div>

            {/* Instructor */}
            <div className="relative">
              <select
                value={instructorId}
                onChange={(e) => setInstructorId(e.target.value)}
                className={selectClasses}
              >
                <option value="All">All Instructors</option>
                {typedInstructors.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Level */}
            <div className="relative">
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className={selectClasses}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-warm border border-border rounded-md p-1">
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-sm transition-all duration-200",
                view === "list"
                  ? "bg-card text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              List
            </button>
            <button
              onClick={() => setView("calendar")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-sm transition-all duration-200",
                view === "calendar"
                  ? "bg-card text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Calendar
            </button>
          </div>
        </div>
      </motion.div>

      {/* Result Count */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="text-sm text-muted mb-6"
      >
        Showing {filtered.length} session{filtered.length !== 1 ? "s" : ""}
      </motion.p>

      {/* List View */}
      {view === "list" && (
        <>
          {filtered.length === 0 ? (
            <EmptyState
              icon="--"
              title="No sessions found"
              description="Try adjusting your filters to find available sessions."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map((session, i) => (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    delay: Math.min(i * 0.06, 0.48),
                    ease: "easeOut",
                  }}
                >
                  <SessionCard
                    session={session}
                    instructor={getInstructor(session.instructorId)}
                    hasPackage
                  />
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Calendar View */}
      {view === "calendar" && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-card border border-border rounded-lg overflow-hidden"
        >
          {/* Desktop Calendar */}
          <div className="hidden md:block overflow-x-auto">
            <div className="min-w-[800px]">
              {/* Day Headers */}
              <div className="grid grid-cols-[72px_repeat(7,1fr)] border-b border-border">
                <div className="p-3 text-xs font-medium text-muted" />
                {DAYS.map((day) => (
                  <div
                    key={day}
                    className="p-3 text-xs font-semibold text-ink text-center border-l border-border"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Time Grid */}
              <div className="relative">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="grid grid-cols-[72px_repeat(7,1fr)] border-b border-border/50"
                    style={{ height: "64px" }}
                  >
                    <div className="p-2 text-xs text-muted font-mono text-right pr-3 pt-0 -translate-y-2">
                      {hour === 0
                        ? "12 AM"
                        : hour < 12
                        ? `${hour} AM`
                        : hour === 12
                        ? "12 PM"
                        : `${hour - 12} PM`}
                    </div>
                    {DAYS.map((day) => (
                      <div
                        key={`${hour}-${day}`}
                        className="border-l border-border/50"
                      />
                    ))}
                  </div>
                ))}

                {/* Session Blocks */}
                {filtered.map((session) => {
                  const dayIdx = getDayIndex(session.date);
                  const timeStart = parseTime(session.time);
                  const topOffset = (timeStart - 6) * 64; // 64px per hour, starting at 6
                  const height = (session.duration / 60) * 64;

                  // Column position: first column (time labels) is 72px, then 7 equal columns
                  const colStart = dayIdx;

                  return (
                    <Link
                      key={session.id}
                      href={`/sessions/${session.id}`}
                      className={cn(
                        "absolute rounded-sm px-2 py-1.5 text-xs font-medium border overflow-hidden transition-all duration-200 hover:shadow-md hover:scale-[1.02] cursor-pointer",
                        CATEGORY_COLORS[session.category] ||
                          "bg-warm border-border text-ink",
                        session.status === "cancelled" && "opacity-40 line-through"
                      )}
                      style={{
                        top: `${topOffset}px`,
                        height: `${Math.max(height - 4, 24)}px`,
                        left: `calc(72px + ${colStart} * ((100% - 72px) / 7) + 3px)`,
                        width: `calc((100% - 72px) / 7 - 6px)`,
                      }}
                    >
                      <div className="truncate font-semibold leading-tight">
                        {session.name}
                      </div>
                      {height > 36 && (
                        <div className="truncate opacity-80 leading-tight mt-0.5">
                          {formatTime(session.time)}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Mobile Calendar - Day-by-day list */}
          <div className="md:hidden">
            {DAYS.map((day, dayIdx) => {
              const daySessions = filtered.filter(
                (s) => getDayIndex(s.date) === dayIdx
              );
              if (daySessions.length === 0) return null;
              return (
                <div key={day}>
                  <div className="px-4 py-2.5 bg-warm/50 border-b border-border">
                    <span className="text-xs font-semibold text-ink uppercase tracking-wider">
                      {day}
                    </span>
                  </div>
                  {daySessions.map((session) => (
                    <Link
                      key={session.id}
                      href={`/sessions/${session.id}`}
                      className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-warm/30 transition-colors"
                    >
                      <div
                        className={cn(
                          "w-1 h-10 rounded-full flex-shrink-0",
                          session.category === "Wellness" && "bg-accent",
                          session.category === "Fitness" && "bg-info",
                          session.category === "Recovery" && "bg-sage"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium text-ink truncate",
                            session.status === "cancelled" &&
                              "line-through opacity-60"
                          )}
                        >
                          {session.name}
                        </p>
                        <p className="text-xs text-muted">
                          {formatTime(session.time)} &middot; {session.duration}{" "}
                          min
                        </p>
                      </div>
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          CATEGORY_COLORS[session.category]
                        )}
                      >
                        {session.category}
                      </span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-3 border-t border-border bg-warm/30">
            <span className="text-xs text-muted font-medium">Categories:</span>
            {["Wellness", "Fitness", "Recovery"].map((cat) => (
              <span key={cat} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-2.5 h-2.5 rounded-full",
                    cat === "Wellness" && "bg-accent",
                    cat === "Fitness" && "bg-info",
                    cat === "Recovery" && "bg-sage"
                  )}
                />
                <span className="text-xs text-muted">{cat}</span>
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
