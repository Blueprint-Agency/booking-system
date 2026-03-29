"use client";

import { useState, useMemo } from "react";
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

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function getInstructor(id: string): Instructor | undefined {
  return typedInstructors.find((i) => i.id === id);
}

function getInstructorName(id: string): string {
  const inst = getInstructor(id);
  return inst ? inst.name : "Instructor";
}

export default function TenantProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const [tab, setTab] = useState<"sessions" | "about">("sessions");

  const tenant = useMemo(
    () => typedTenants.find((t) => t.slug === slug),
    [slug]
  );

  const tenantSessions = useMemo(() => {
    if (!tenant) return [];
    return typedSessions
      .filter((s) => s.tenantId === tenant.id)
      .sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        return a.time.localeCompare(b.time);
      });
  }, [tenant]);

  if (!tenant) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState
          icon="--"
          title="Business not found"
          description="The business you're looking for doesn't exist or may have been removed."
          actionLabel="Back to Explore"
          actionHref="/explore"
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <nav className="flex items-center gap-1.5 text-sm text-muted mb-6">
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
          <span className="text-ink font-medium">{tenant.name}</span>
        </nav>
      </motion.div>

      {/* Cover Area */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="mb-8"
      >
        <div
          className={cn(
            "relative h-48 rounded-xl bg-gradient-to-r overflow-hidden",
            tenant.coverGradient
          )}
        >
          <div className="absolute inset-0 flex items-end p-6">
            <div className="flex items-end gap-4">
              <div className="w-16 h-16 rounded-xl bg-card/90 backdrop-blur-sm flex items-center justify-center text-5xl shadow-soft">
                {tenant.logoEmoji}
              </div>
              <div className="pb-1">
                <h1 className="font-serif text-3xl text-ink drop-shadow-sm">
                  {tenant.name}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-card/80 backdrop-blur-sm text-ink">
                    {tenant.industry}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-ink/70">
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
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {tenant.location}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mb-6"
      >
        <div className="flex items-center gap-1 border-b border-border">
          <button
            onClick={() => setTab("sessions")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px",
              tab === "sessions"
                ? "text-ink border-accent"
                : "text-muted border-transparent hover:text-ink"
            )}
          >
            Sessions ({tenantSessions.length})
          </button>
          <button
            onClick={() => setTab("about")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px",
              tab === "about"
                ? "text-ink border-accent"
                : "text-muted border-transparent hover:text-ink"
            )}
          >
            About
          </button>
        </div>
      </motion.div>

      {/* Sessions Tab */}
      {tab === "sessions" && (
        <>
          {tenantSessions.length === 0 ? (
            <EmptyState
              icon="--"
              title="No sessions yet"
              description="This business hasn't published any sessions yet. Check back soon!"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {tenantSessions.map((session, i) => {
                const isCancelled = session.status === "cancelled";
                const instructorName = getInstructorName(session.instructorId);

                return (
                  <motion.div
                    key={session.id}
                    custom={i}
                    variants={fadeUp}
                    initial="hidden"
                    animate="visible"
                  >
                    <Link
                      href={`/explore/${slug}/sessions/${session.id}`}
                      className={cn(
                        "block bg-card border border-border rounded-lg p-6 transition-all duration-300",
                        "hover:shadow-hover hover:-translate-y-0.5 hover:border-accent",
                        isCancelled && "opacity-60"
                      )}
                    >
                      {/* Badges */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={session.category} />
                          <StatusBadge status={session.level} />
                          {session.type !== "regular" && (
                            <StatusBadge status={session.type} />
                          )}
                        </div>
                        <StatusBadge status={session.status} />
                      </div>

                      {/* Name */}
                      <h3
                        className={cn(
                          "font-serif text-lg mb-2",
                          isCancelled && "line-through"
                        )}
                      >
                        {session.name}
                      </h3>

                      {/* Date / Time */}
                      <p className="text-sm text-muted mb-1">
                        {formatDate(session.date)} &middot;{" "}
                        {formatTime(session.time)} &middot; {session.duration}{" "}
                        min
                      </p>

                      {/* Instructor */}
                      <p className="text-sm text-muted mb-3">
                        {instructorName}
                      </p>

                      {/* Capacity + Price */}
                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                        <CapacityBar
                          booked={session.bookedCount}
                          capacity={session.capacity}
                          className="flex-1 mr-4"
                        />
                        <span className="text-sm font-medium text-ink whitespace-nowrap">
                          {formatCurrency(session.price)}
                        </span>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* About Tab */}
      {tab === "about" && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-serif text-lg text-ink mb-3">About</h2>
            <p className="text-sm text-muted leading-relaxed">
              {tenant.description}
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-serif text-lg text-ink mb-3">Location</h2>
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
                className="text-accent-deep"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {tenant.location}
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
