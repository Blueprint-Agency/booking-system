"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Instructor } from "@/types";
import instructorsData from "@/data/instructors.json";

const typedInstructors = instructorsData as Instructor[];

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function PrivateSessionsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="font-serif text-3xl text-ink mb-2">Private Sessions</h1>
        <p className="text-sm text-muted max-w-xl">
          Personalised one-on-one or semi-private training with our instructors. Submit a request and our team will confirm your session within 12 hours.
        </p>
      </div>

      {/* Instructors grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {typedInstructors.map((instructor, i) => (
          <motion.div
            key={instructor.id}
            custom={i}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
          >
            <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-5">
              {/* Instructor info */}
              <div className="flex items-start gap-4">
                <img
                  src={instructor.avatarUrl}
                  alt={instructor.name}
                  className="w-16 h-16 rounded-full object-cover border-2 border-border shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="font-serif text-xl text-ink">{instructor.name}</h3>
                  <p className="text-sm text-muted leading-relaxed mt-1">{instructor.bio}</p>
                </div>
              </div>

              {/* CTA */}
              {instructor.available ? (
                <Link
                  href={`/private-sessions/${instructor.id}`}
                  className="w-full text-center py-2.5 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                >
                  Schedule Private Class
                </Link>
              ) : (
                <button
                  disabled
                  className="w-full py-2.5 text-sm font-medium text-muted bg-warm border border-border rounded-md cursor-not-allowed"
                >
                  Not Available
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Info note */}
      <div className="mt-10 bg-warm border border-border rounded-xl p-5">
        <p className="text-sm font-medium text-ink mb-1">How private sessions work</p>
        <ul className="text-sm text-muted space-y-1 list-disc list-inside">
          <li>Submit a session request — no upfront payment needed</li>
          <li>We confirm availability and details within 12 hours</li>
          <li>Once confirmed, your PT package is activated</li>
          <li>Sessions use PT credits (1 credit = 30 mins) — separate from group class credits</li>
          <li>You can hold multiple PT packages and credits are auto-deducted from the soonest-expiring one</li>
        </ul>
        <p className="text-sm text-muted mt-3">
          Don&apos;t have a PT package?{" "}
          <Link href="/packages" className="text-accent hover:text-accent-deep underline underline-offset-2 transition-colors">
            Browse packages →
          </Link>
        </p>
      </div>
    </div>
  );
}
