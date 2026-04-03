"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { formatDate, formatTime } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";

const typedSessions = sessionsData as Session[];
const typedInstructors = instructorsData as Instructor[];

const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

export default function WorkshopConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const session = typedSessions.find((s) => s.id === id);
  const instructor = typedInstructors.find((i) => i?.id === session?.instructorId);

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <EmptyState
          icon="--"
          title="Workshop not found"
          description="This workshop doesn't exist or has been removed."
          actionLabel="Back to Workshops"
          actionHref="/workshops"
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      {/* Breadcrumb */}
      <motion.nav {...fadeUp} transition={{ duration: 0.4 }} className="flex items-center gap-1.5 text-sm text-muted mb-6">
        <Link href="/workshops" className="hover:text-ink transition-colors">Workshops</Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-ink font-medium">{session.name}</span>
      </motion.nav>

      {/* Heading */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.05 }} className="mb-8">
        <h1 className="font-serif text-3xl text-ink mb-2">{session.name}</h1>
        <p className="text-muted text-sm">Please review the details below before purchasing.</p>
      </motion.div>

      {/* Details card */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }} className="bg-card border border-border rounded-xl p-6 mb-6 space-y-5">
        <div className="grid grid-cols-2 gap-5">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Date</p>
            <p className="text-sm font-medium text-ink">{formatDate(session.date)}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Time</p>
            <p className="text-sm font-medium text-ink">{formatTime(session.time)}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Duration</p>
            <p className="text-sm font-medium text-ink">{session.duration} minutes</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Level</p>
            <p className="text-sm font-medium text-ink capitalize">{session.level === "all" ? "All levels" : session.level}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Spots left</p>
            <p className="text-sm font-medium text-ink">{session.capacity - session.bookedCount} of {session.capacity}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Instructor</p>
            <p className="text-sm font-medium text-ink">{instructor?.name ?? "Instructor"}</p>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">About this workshop</p>
          <p className="text-sm text-muted leading-relaxed">{session.description}</p>
        </div>
      </motion.div>

      {/* Pricing & CTA */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.2 }} className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Price per person</p>
            <p className="font-serif text-3xl text-ink">S${session.price}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">You will be redirected to checkout</p>
          </div>
        </div>

        <Link
          href={`/checkout?session=${session.id}&type=workshop`}
          className="block w-full text-center py-3.5 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors shadow-soft hover:shadow-hover"
        >
          Purchase Now
        </Link>
        <Link
          href="/workshops"
          className="block w-full text-center py-3 text-sm text-muted hover:text-ink transition-colors mt-3"
        >
          Back to Workshops
        </Link>
      </motion.div>
    </div>
  );
}
