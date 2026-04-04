"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { getLocation } from "@/lib/utils";
import { MOCK_USER } from "@/data/mock-user";
import type { Instructor, Location } from "@/types";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const typedInstructors = instructorsData as Instructor[];
const typedLocations = locationsData as Location[];

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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-10">
        <div>
          <h1 className="font-serif text-3xl text-ink mb-2">Private Sessions</h1>
          <p className="text-sm text-muted max-w-xl">
            Personalised one-on-one or semi-private training with our instructors. Submit a request and our team will confirm your session within 12 hours.
          </p>
        </div>

        {/* PT credit balance */}
        {(MOCK_USER.pt1on1Credits > 0 || MOCK_USER.pt2on1Credits > 0) ? (
          <Link href="/account/packages" className="group self-start shrink-0">
            <div className="px-4 py-2.5 bg-accent-glow/30 border border-accent/20 rounded-xl text-sm group-hover:border-accent/40 transition-colors space-y-2">
              {MOCK_USER.pt1on1Credits > 0 && (
                <>
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-accent-deep inline-block" />
                    <span className="text-accent-deep font-semibold">{MOCK_USER.pt1on1Credits} 1-on-1</span>
                    <span className="text-muted text-xs">· {MOCK_USER.pt1on1PackageName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-accent/20 overflow-hidden">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(MOCK_USER.pt1on1Credits / MOCK_USER.pt1on1PackageTotal) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-muted">expires {new Date(MOCK_USER.pt1on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</span>
                  </div>
                </>
              )}
              {MOCK_USER.pt2on1Credits > 0 && MOCK_USER.pt2on1PackageName && MOCK_USER.pt2on1PackageExpiry && (
                <>
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-warning inline-block" />
                    <span className="text-warning font-semibold">{MOCK_USER.pt2on1Credits} 2-on-1</span>
                    <span className="text-muted text-xs">· {MOCK_USER.pt2on1PackageName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-warning/20 overflow-hidden">
                      <div className="h-full rounded-full bg-warning" style={{ width: `${(MOCK_USER.pt2on1Credits / MOCK_USER.pt2on1PackageTotal) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-muted">expires {new Date(MOCK_USER.pt2on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</span>
                  </div>
                </>
              )}
            </div>
          </Link>
        ) : (
          <Link
            href="/packages"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent-deep transition-colors self-start"
          >
            Buy PT Package
          </Link>
        )}
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
                  {instructor.locationIds && instructor.locationIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {instructor.locationIds.map((locId) => {
                        const loc = getLocation(locId);
                        return loc ? (
                          <span key={locId} className="inline-flex items-center gap-1 text-[10px] font-mono text-muted bg-warm px-2 py-0.5 rounded-full border border-border">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                            </svg>
                            {loc.shortName}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
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
