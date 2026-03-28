"use client";

import Link from "next/link";
import { Calendar, User, Clock, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

function AnimatedCheckmark() {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
      className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sage"
    >
      <motion.svg
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.4 }}
        className="h-10 w-10 text-white"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <motion.path
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.45 }}
          d="M5 13l4 4L19 7"
        />
      </motion.svg>
    </motion.div>
  );
}

function ProgressRing({
  used,
  total,
}: {
  used: number;
  total: number;
}) {
  const remaining = total - used;
  const progress = remaining / total;
  const circumference = 2 * Math.PI * 18;
  const offset = circumference * (1 - progress);

  return (
    <div className="relative inline-flex h-12 w-12 items-center justify-center">
      <svg className="h-12 w-12 -rotate-90" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="3"
        />
        <motion.circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke="var(--color-sage)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
        />
      </svg>
      <span className="absolute text-xs font-semibold text-ink">
        {remaining}
      </span>
    </div>
  );
}

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export default function BookingConfirmationPage() {
  const sessionsUsed = 6;
  const sessionsTotal = 10;
  const sessionsRemaining = sessionsTotal - sessionsUsed;

  return (
    <div className="min-h-screen bg-paper px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-lg">
        {/* Checkmark */}
        <AnimatedCheckmark />

        {/* Heading */}
        <motion.h1
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-6 text-center font-serif text-3xl text-ink"
        >
          Booking Confirmed
        </motion.h1>

        <motion.p
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-2 text-center text-sm text-muted"
        >
          You&apos;re all set. See you on the mat!
        </motion.p>

        {/* Session Details Card */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="mt-8 rounded-lg border border-border bg-card p-5 shadow-soft"
        >
          <div className="flex items-start gap-4 border-l-4 border-sage pl-4">
            <div className="flex-1 space-y-2">
              <h3 className="font-serif text-lg text-ink">Morning Flow</h3>
              <div className="space-y-1">
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Calendar className="h-3.5 w-3.5" />
                  Mon, Apr 7 &middot; 7:00 AM &middot; 60 min
                </p>
                <p className="flex items-center gap-2 text-sm text-muted">
                  <User className="h-3.5 w-3.5" />
                  Maya Chen
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Package Balance */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.85 }}
          className="mt-4 rounded-lg border border-border bg-card p-5 shadow-soft"
        >
          <div className="flex items-center gap-4">
            <ProgressRing used={sessionsUsed} total={sessionsTotal} />
            <div>
              <p className="text-sm font-medium text-ink">
                {sessionsRemaining} sessions remaining
              </p>
              <p className="text-xs text-muted mt-0.5">
                on Standard Pack
              </p>
            </div>
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 1.0 }}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <button
            type="button"
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-sm font-medium text-muted transition",
              "hover:border-ink hover:text-ink"
            )}
          >
            <Calendar className="h-4 w-4" />
            Add to Calendar
          </button>

          <Link
            href="/account"
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold text-white transition-all",
              "bg-accent hover:bg-accent-deep active:scale-[0.98] shadow-soft hover:shadow-hover"
            )}
          >
            View My Bookings
            <ChevronRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
