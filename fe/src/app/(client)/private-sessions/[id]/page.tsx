"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { EmptyState } from "@/components/empty-state";
import { getLocation } from "@/lib/utils";
import { MOCK_USER } from "@/data/mock-user";
import type { Instructor, Location } from "@/types";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const typedInstructors = instructorsData as Instructor[];
const typedLocations = locationsData as Location[];

const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };


export default function PrivateSessionConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const instructor = typedInstructors.find((i) => i.id === id);
  const [submitted, setSubmitted] = useState(false);
  const instructorLocations = instructor?.locationIds
    ? typedLocations.filter((l) => instructor.locationIds.includes(l.id))
    : [];
  const [preferredLocation, setPreferredLocation] = useState(instructorLocations[0]?.id ?? "");

  if (!instructor) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <EmptyState
          icon="--"
          title="Instructor not found"
          description="This instructor profile doesn't exist or has been removed."
          actionLabel="Back to Private Sessions"
          actionHref="/private-sessions"
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      {/* Breadcrumb */}
      <motion.nav {...fadeUp} transition={{ duration: 0.4 }} className="flex items-center gap-1.5 text-sm text-muted mb-6">
        <Link href="/private-sessions" className="hover:text-ink transition-colors">Private Sessions</Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-ink font-medium">{instructor.name}</span>
      </motion.nav>

      {/* Instructor card */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.05 }} className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4">
          <img
            src={instructor.avatarUrl}
            alt={instructor.name}
            className="w-20 h-20 rounded-full object-cover border-2 border-border shrink-0"
          />
          <div>
            <h1 className="font-serif text-2xl text-ink mb-1">{instructor.name}</h1>
            <p className="text-sm text-muted leading-relaxed">{instructor.bio}</p>
            {instructorLocations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {instructorLocations.map((loc) => (
                  <span key={loc.id} className="inline-flex items-center gap-1 text-[10px] font-mono text-muted bg-warm px-2 py-0.5 rounded-full border border-border">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                    {loc.shortName}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* PT credit balance */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }} className="mb-6">
        {/* 1-on-1 PT credits */}
        {MOCK_USER.pt1on1Credits > 0 && (
          <div className="bg-accent-glow/20 border border-accent/15 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent-deep" />
                <span className="text-sm font-semibold text-accent-deep">{MOCK_USER.pt1on1Credits} PT credits (1-on-1)</span>
              </div>
              <span className="text-[11px] text-muted">{MOCK_USER.pt1on1PackageName}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-accent/15 overflow-hidden mb-1.5">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(MOCK_USER.pt1on1Credits / MOCK_USER.pt1on1PackageTotal) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted">1 credit = 30 mins · 60-min session uses 2 credits</p>
              <p className="text-[11px] text-muted">expires {new Date(MOCK_USER.pt1on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
            </div>
          </div>
        )}

        {/* 2-on-1 PT credits */}
        {MOCK_USER.pt2on1Credits > 0 && MOCK_USER.pt2on1PackageExpiry && (
          <div className="bg-warning-bg border border-warning/20 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-sm font-semibold text-warning">{MOCK_USER.pt2on1Credits} PT credits (2-on-1)</span>
              </div>
              <span className="text-[11px] text-muted">{MOCK_USER.pt2on1PackageName}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-warning/15 overflow-hidden mb-1.5">
              <div className="h-full rounded-full bg-warning" style={{ width: `${(MOCK_USER.pt2on1Credits / MOCK_USER.pt2on1PackageTotal) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted">1 credit = 30 mins</p>
              <p className="text-[11px] text-muted">expires {new Date(MOCK_USER.pt2on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
            </div>
          </div>
        )}

        {/* No PT credits at all */}
        {MOCK_USER.pt1on1Credits === 0 && MOCK_USER.pt2on1Credits === 0 && (
          <div className="bg-warning-bg border border-warning/20 rounded-xl p-4">
            <p className="text-sm font-medium text-warning mb-1">No PT credits</p>
            <p className="text-xs text-muted">
              You need PT credits to book private sessions. 1 credit = 30 mins.{" "}
              <Link href="/packages" className="text-accent hover:text-accent-deep underline underline-offset-2 transition-colors">
                Buy a PT package →
              </Link>
            </p>
          </div>
        )}
      </motion.div>

      {/* Preferred location */}
      {instructorLocations.length > 1 && (
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.13 }} className="mb-6">
          <label className="block text-sm font-medium text-ink mb-2">Preferred location</label>
          <div className="inline-flex rounded-lg border border-border bg-warm p-1">
            {instructorLocations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => setPreferredLocation(loc.id)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap ${
                  preferredLocation === loc.id ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
                }`}
              >
                {loc.name}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Request CTA */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.15 }}>
        <button
          onClick={() => setSubmitted(true)}
          className="w-full py-3.5 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors shadow-soft hover:shadow-hover"
        >
          Request Appointment
        </button>
        <Link
          href="/private-sessions"
          className="block w-full text-center py-3 text-sm text-muted hover:text-ink transition-colors mt-2"
        >
          Back to Private Sessions
        </Link>
      </motion.div>

      {/* Success dialog */}
      <AnimatePresence>
        {submitted && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="bg-card rounded-2xl p-8 max-w-sm w-full shadow-modal text-center"
            >
              {/* Icon */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                className="w-16 h-16 rounded-full bg-sage-light flex items-center justify-center mx-auto mb-5"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sage">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </motion.div>

              <h2 className="font-serif text-2xl text-ink mb-2">Request received!</h2>
              <p className="text-sm text-muted leading-relaxed mb-4">
                We&apos;ve noted your interest in a private session with{" "}
                <span className="font-medium text-ink">{instructor.name}</span>
                {preferredLocation && getLocation(preferredLocation) && (
                  <> at <span className="font-medium text-ink">{getLocation(preferredLocation)!.name}</span></>
                )}.
                Our team will reach out within <span className="font-medium text-ink">12 hours</span> to confirm availability and next steps.
              </p>

              {/* PT credit note */}
              {MOCK_USER.pt1on1Credits > 0 && (
                <div className="bg-accent-glow/20 border border-accent/15 rounded-lg p-3 mb-5 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Your 1-on-1 PT credits</span>
                    <span className="text-xs font-semibold text-accent-deep">{MOCK_USER.pt1on1Credits} credits</span>
                  </div>
                  <p className="text-[10px] text-muted mt-1">Credits will be deducted once the session is confirmed.</p>
                </div>
              )}
              {MOCK_USER.pt2on1Credits > 0 && (
                <div className="bg-warning-bg border border-warning/15 rounded-lg p-3 mb-5 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Your 2-on-1 PT credits</span>
                    <span className="text-xs font-semibold text-warning">{MOCK_USER.pt2on1Credits} credits</span>
                  </div>
                  <p className="text-[10px] text-muted mt-1">Credits will be deducted once the session is confirmed.</p>
                </div>
              )}

              <Link
                href="/account"
                className="block w-full py-3 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors"
              >
                Got it
              </Link>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
