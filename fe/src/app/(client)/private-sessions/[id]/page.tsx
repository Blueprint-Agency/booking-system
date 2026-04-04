"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { EmptyState } from "@/components/empty-state";
import type { Instructor } from "@/types";
import instructorsData from "@/data/instructors.json";

const typedInstructors = instructorsData as Instructor[];

const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };


export default function PrivateSessionConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const instructor = typedInstructors.find((i) => i.id === id);
  const [submitted, setSubmitted] = useState(false);

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
          </div>
        </div>
      </motion.div>

      {/* Pricing hint */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }} className="mb-6">
        <p className="text-xs text-muted">
          Packages from S$1,600 · 1 credit = 30 mins ·{" "}
          <Link href="/packages#pt" className="text-accent hover:text-accent-deep underline underline-offset-2 transition-colors">
            View pricing →
          </Link>
        </p>
      </motion.div>

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
              <p className="text-sm text-muted leading-relaxed mb-6">
                We&apos;ve noted your interest in a private session with{" "}
                <span className="font-medium text-ink">{instructor.name}</span>.
                Our team will reach out within <span className="font-medium text-ink">12 hours</span> to confirm availability and next steps.
              </p>

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
