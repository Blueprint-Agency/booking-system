"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { cn, formatDate, formatTime, formatCurrency } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { CapacityBar } from "@/components/capacity-bar";
import { EmptyState } from "@/components/empty-state";
import type { Tenant, Session, Instructor } from "@/types";
import tenants from "@/data/tenants.json";
import sessions from "@/data/sessions.json";
import instructors from "@/data/instructors.json";

const typedTenants = tenants as Tenant[];
const typedSessions = sessions as Session[];
const typedInstructors = instructors as Instructor[];

function parseRecurrence(rrule: string | null): string | null {
  if (!rrule) return null;
  const match = rrule.match(/BYDAY=([A-Z,]+)/);
  if (!match) return null;
  const dayMap: Record<string, string> = {
    MO: "Mon",
    TU: "Tue",
    WE: "Wed",
    TH: "Thu",
    FR: "Fri",
    SA: "Sat",
    SU: "Sun",
  };
  const days = match[1].split(",").map((d) => dayMap[d] || d);
  return `Repeats weekly on ${days.join(", ")}`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getInstructor(id: string): Instructor | undefined {
  return typedInstructors.find((i) => i.id === id);
}

function getInstructorName(id: string): string {
  const inst = getInstructor(id);
  return inst ? inst.name : "Instructor";
}

export default function TenantSessionDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();

  const tenant = typedTenants.find((t) => t.slug === slug);
  const session = typedSessions.find((s) => s.id === id);

  // Not found or session doesn't belong to this tenant
  if (!tenant || !session || session.tenantId !== tenant.id) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState
          icon="--"
          title={!tenant ? "Business not found" : "Session not found"}
          description={
            !tenant
              ? "The business you're looking for doesn't exist or may have been removed."
              : "This session doesn't exist or doesn't belong to this business."
          }
          actionLabel="Back to Explore"
          actionHref="/explore"
        />
      </div>
    );
  }

  const instructor = getInstructor(session.instructorId);
  const instructorName = getInstructorName(session.instructorId);
  const isCancelled = session.status === "cancelled";
  const isFull = session.bookedCount >= session.capacity;
  const hasPackage = session.packageEligible;
  const recurrenceText = parseRecurrence(session.recurrence);

  const fadeUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
        <nav className="flex items-center gap-1.5 text-sm text-muted mb-6 flex-wrap">
          <Link
            href="/explore"
            className="hover:text-ink transition-colors duration-200"
          >
            Explore
          </Link>
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
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <Link
            href={`/explore/${slug}`}
            className="hover:text-ink transition-colors duration-200"
          >
            {tenant.name}
          </Link>
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
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <Link
            href={`/explore/${slug}/sessions`}
            className="hover:text-ink transition-colors duration-200"
          >
            Sessions
          </Link>
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
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-ink font-medium">{session.name}</span>
        </nav>
      </motion.div>

      {/* Cancelled Banner */}
      {isCancelled && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="bg-error-bg border border-error/20 rounded-md px-5 py-4 mb-6 flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-error"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-error">
              This session has been cancelled
            </p>
            <p className="text-xs text-error/70 mt-0.5">
              Please check other available sessions.
            </p>
          </div>
        </motion.div>
      )}

      {/* Header */}
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mb-8"
      >
        <h1
          className={cn(
            "font-serif text-2xl sm:text-3xl text-ink mb-3",
            isCancelled && "line-through opacity-60"
          )}
        >
          {session.name}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={session.category} />
          <StatusBadge status={session.level} />
          {session.type !== "regular" && (
            <StatusBadge status={session.type} />
          )}
          {isCancelled && <StatusBadge status="cancelled" />}
        </div>
      </motion.div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (Main) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Schedule Block */}
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="bg-card border border-border rounded-lg p-6"
          >
            <h2 className="font-serif text-lg text-ink mb-4">Schedule</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-warm flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-accent-deep"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-muted font-medium uppercase tracking-wider mb-0.5">
                    Date
                  </p>
                  <p className="text-sm font-medium text-ink">
                    {formatDate(session.date)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-warm flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-accent-deep"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-muted font-medium uppercase tracking-wider mb-0.5">
                    Time
                  </p>
                  <p className="text-sm font-medium text-ink">
                    {formatTime(session.time)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-warm flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-accent-deep"
                  >
                    <path d="M5 22h14" />
                    <path d="M5 2h14" />
                    <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
                    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-muted font-medium uppercase tracking-wider mb-0.5">
                    Duration
                  </p>
                  <p className="text-sm font-medium text-ink">
                    {session.duration} minutes
                  </p>
                </div>
              </div>
            </div>

            {recurrenceText && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted flex items-center gap-2">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-sage"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  {recurrenceText}
                </p>
              </div>
            )}
          </motion.div>

          {/* Instructor Card */}
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-card border border-border rounded-lg p-6"
          >
            <h2 className="font-serif text-lg text-ink mb-4">Instructor</h2>
            <div className="flex items-start gap-4">
              <img
                src={instructor?.avatarUrl || 'https://placehold.co/200x200/f5f0e8/8b8b8b?text=??&font=playfair-display'}
                alt={instructorName}
                className="w-14 h-14 rounded-full object-cover border-2 border-border flex-shrink-0"
              />
              <div>
                <p className="text-base font-medium text-ink mb-1">
                  {instructorName}
                </p>
                <p className="text-sm text-muted leading-relaxed">
                  {instructor
                    ? instructor.bio
                    : "Experienced instructor at " + tenant.name + "."}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Description */}
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="bg-card border border-border rounded-lg p-6"
          >
            <h2 className="font-serif text-lg text-ink mb-3">
              About This Session
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              {session.description}
            </p>
            {session.lateCutoffMinutes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted flex items-center gap-2">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-warning"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Late arrivals cut off {session.lateCutoffMinutes} minutes after
                  start
                </p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Right Column (Sidebar) */}
        <div className="lg:col-span-1">
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-card border border-border rounded-lg p-6 sticky top-24"
          >
            {/* Capacity */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-ink">Capacity</h3>
                <span className="text-xs font-mono text-muted">
                  {session.bookedCount}/{session.capacity} spots filled
                </span>
              </div>
              <CapacityBar
                booked={session.bookedCount}
                capacity={session.capacity}
              />
              {session.waitlistCount > 0 && (
                <p className="text-xs text-warning mt-2">
                  {session.waitlistCount} on waitlist
                </p>
              )}
            </div>

            {/* Price */}
            <div className="mb-6 pb-6 border-b border-border">
              <p className="text-xs text-muted font-medium uppercase tracking-wider mb-1">
                Price
              </p>
              <p className="text-2xl font-serif text-ink">
                {formatCurrency(session.price)}
              </p>
              {session.packageEligible && (
                <p className="text-xs text-sage mt-1 flex items-center gap-1">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Eligible for package credits
                </p>
              )}
            </div>

            {/* CTA Buttons */}
            {!isCancelled && (
              <div className="space-y-3">
                {isFull ? (
                  session.waitlistEnabled ? (
                    <Link
                      href="/booking/confirmation"
                      className="block w-full text-center px-5 py-3 bg-warning-bg text-warning font-medium text-sm rounded-md border border-warning/20 hover:bg-warning/10 transition-colors duration-200"
                    >
                      Join Waitlist
                    </Link>
                  ) : (
                    <button
                      disabled
                      className="block w-full text-center px-5 py-3 bg-warm text-muted font-medium text-sm rounded-md cursor-not-allowed"
                    >
                      Session Full
                    </button>
                  )
                ) : hasPackage ? (
                  <>
                    <Link
                      href="/booking/confirmation"
                      className="block w-full text-center px-5 py-3 bg-sage text-white font-medium text-sm rounded-md hover:bg-sage/90 transition-all duration-200 hover:shadow-md"
                    >
                      Book Now &mdash; Use Package
                    </Link>
                    <p className="text-center text-xs text-muted">
                      or pay{" "}
                      <span className="font-medium text-ink">
                        {formatCurrency(session.price)}
                      </span>{" "}
                      drop-in
                    </p>
                  </>
                ) : (
                  <Link
                    href="/booking/confirmation"
                    className="block w-full text-center px-5 py-3 bg-accent text-white font-medium text-sm rounded-md hover:bg-accent-deep transition-all duration-200 hover:shadow-md"
                  >
                    Book Now &mdash; {formatCurrency(session.price)}
                  </Link>
                )}
              </div>
            )}

            {isCancelled && (
              <div className="text-center py-2">
                <p className="text-sm text-muted">
                  Booking is not available for cancelled sessions.
                </p>
                <Link
                  href={`/explore/${slug}/sessions`}
                  className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent-deep transition-colors mt-2"
                >
                  Browse other sessions
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
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>
            )}

            {/* Session Details Summary */}
            <div className="mt-6 pt-6 border-t border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Type</span>
                <span className="text-xs font-medium text-ink capitalize">
                  {session.type}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Level</span>
                <span className="text-xs font-medium text-ink capitalize">
                  {session.level === "all" ? "All Levels" : session.level}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Instructor</span>
                <span className="text-xs font-medium text-ink">
                  {instructorName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Business</span>
                <Link
                  href={`/explore/${slug}`}
                  className="text-xs font-medium text-accent hover:text-accent-deep transition-colors"
                >
                  {tenant.name}
                </Link>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Waitlist</span>
                <span className="text-xs font-medium text-ink">
                  {session.waitlistEnabled ? "Enabled" : "Not available"}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
