"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// Mock class details for prototype
const CLASS = {
  name: "Morning Sadhana",
  date: "Monday, 7 April 2026",
  time: "7:00 AM",
  duration: "60 min",
  instructor: "Master Sumit",
  category: "Yoga",
  level: "Beginner",
  spotsLeft: 3,
  capacity: 15,
};

const USER_CREDITS = 8;
const USER_PACKAGE = "Bundle of 10";

const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

export default function BookingConfirmationPage() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-10 sm:py-14">
      {/* Breadcrumb */}
      <motion.nav {...fadeUp} transition={{ duration: 0.4 }} className="flex items-center gap-1.5 text-sm text-muted mb-6">
        <Link href="/classes" className="hover:text-ink transition-colors">Classes</Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-ink font-medium">Confirm Booking</span>
      </motion.nav>

      <motion.h1 {...fadeUp} transition={{ duration: 0.5, delay: 0.05 }} className="font-serif text-3xl text-ink mb-2">
        Confirm your booking
      </motion.h1>
      <motion.p {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }} className="text-sm text-muted mb-8">
        Please review the class details before reserving your spot.
      </motion.p>

      {/* Class details card */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.15 }} className="bg-card border border-border rounded-xl p-6 mb-4">
        <div className="flex items-start gap-3 mb-5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-accent-deep bg-accent-glow/30 px-2 py-0.5 rounded-full">
            {CLASS.category}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted bg-warm px-2 py-0.5 rounded-full border border-border">
            {CLASS.level}
          </span>
        </div>

        <h2 className="font-serif text-2xl text-ink mb-4">{CLASS.name}</h2>

        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-md bg-warm flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <span className="text-ink">{CLASS.date}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-md bg-warm flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <span className="text-ink">{CLASS.time} · {CLASS.duration}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-md bg-warm flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <span className="text-ink">{CLASS.instructor}</span>
          </div>
        </div>

        <div className="border-t border-border mt-5 pt-4 flex items-center justify-between text-sm">
          <span className="text-muted">{CLASS.spotsLeft} of {CLASS.capacity} spots remaining</span>
          <div className="w-24 h-1.5 bg-warm rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full"
              style={{ width: `${(CLASS.spotsLeft / CLASS.capacity) * 100}%` }}
            />
          </div>
        </div>
      </motion.div>

      {/* Credit summary card */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.2 }} className="bg-sage-light border border-sage/20 rounded-xl p-5 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">1 credit will be used</p>
            <p className="text-xs text-muted mt-0.5">{USER_PACKAGE} · {USER_CREDITS - 1} credits remaining after booking</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-sage/20 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sage">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.25 }} className="flex flex-col gap-3">
        <button
          onClick={() => setConfirmed(true)}
          className="w-full py-3.5 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors shadow-soft hover:shadow-hover active:scale-[0.99]"
        >
          Reserve Now
        </button>
        <Link
          href="/classes"
          className="w-full text-center py-3 text-sm text-muted hover:text-ink transition-colors"
        >
          Back to Classes
        </Link>
      </motion.div>

      {/* ── Success dialog ─────────────────────────────── */}
      <AnimatePresence>
        {confirmed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="bg-card rounded-2xl px-8 py-10 max-w-sm w-full shadow-modal text-center"
            >
              {/* Animated checkmark */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                className="w-20 h-20 rounded-full bg-sage flex items-center justify-center mx-auto mb-6"
              >
                <motion.svg
                  width="36" height="36" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="text-white"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.45 }}
                >
                  <motion.path
                    d="M5 13l4 4L19 7"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.45 }}
                  />
                </motion.svg>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.4 }}
              >
                <h2 className="font-serif text-2xl text-ink mb-3 leading-snug">
                  Your booking is confirmed!
                </h2>
                <p className="text-sm text-muted mb-8">
                  Please arrive <span className="font-semibold text-ink">15 minutes before class</span> to sign in and settle in.
                </p>

                <Link
                  href="/account"
                  onClick={() => setConfirmed(false)}
                  className="block w-full py-3.5 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors"
                >
                  I will attend on time
                </Link>
              </motion.div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
