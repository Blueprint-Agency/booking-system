"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { formatDate, formatTime, getLocation } from "@/lib/utils";
import type { Session, Instructor } from "@/types";
import { MOCK_USER } from "@/data/mock-user";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";

const allSessions = sessionsData as Session[];
const allInstructors = instructorsData as Instructor[];

// Mirrors packages/page.tsx and checkout/page.tsx data
const PACKAGE_DISPLAY: Record<string, { name: string; subtitle: string }> = {
  "b-otp":    { name: "One-time Pass",             subtitle: "1 credit · valid 1 day" },
  "b-10":     { name: "Bundle of 10",               subtitle: "10 credits · valid 90 days" },
  "b-20":     { name: "Bundle of 20",               subtitle: "20 credits · valid 180 days" },
  "b-30":     { name: "Bundle of 30",               subtitle: "30 credits · valid 365 days" },
  "b-50":     { name: "Bundle of 50",               subtitle: "50 credits · valid 365 days" },
  "b-100":    { name: "Bundle of 100",              subtitle: "100 credits · valid 365 days" },
  "b-travel": { name: "Travel Package",             subtitle: "5 credits · valid 30 days" },
  "u-3":      { name: "3-Month Unlimited",          subtitle: "Unlimited classes · 3 months" },
  "u-6":      { name: "6-Month Unlimited",          subtitle: "Unlimited classes · 6 months" },
  "u-12":     { name: "12-Month Unlimited",         subtitle: "Unlimited classes · 12 months" },
  "p1-10":    { name: "VIP 1-on-1 · 10 Sessions",  subtitle: "10 private sessions" },
  "p1-20":    { name: "VIP 1-on-1 · 20 Sessions",  subtitle: "20 private sessions" },
  "p1-30":    { name: "VIP 1-on-1 · 30 Sessions",  subtitle: "30 private sessions" },
  "p1-40":    { name: "VIP 1-on-1 · 40 Sessions",  subtitle: "40 private sessions" },
  "p1-50":    { name: "VIP 1-on-1 · 50 Sessions",  subtitle: "50 private sessions" },
  "p1-100":   { name: "VIP 1-on-1 · 100 Sessions", subtitle: "100 private sessions" },
  "p2-10":    { name: "VIP 2-on-1 · 10 Sessions",  subtitle: "10 private sessions" },
  "p2-20":    { name: "VIP 2-on-1 · 20 Sessions",  subtitle: "20 private sessions" },
  "p2-30":    { name: "VIP 2-on-1 · 30 Sessions",  subtitle: "30 private sessions" },
  "p2-50":    { name: "VIP 2-on-1 · 50 Sessions",  subtitle: "50 private sessions" },
};

// Mock user state — from central source
const USER_CREDITS = MOCK_USER.classCredits;
const USER_PACKAGE = MOCK_USER.classPackageName;

const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

// ── Reusable animated checkmark ───────────────────────
function SuccessIcon() {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="w-20 h-20 rounded-full bg-sage flex items-center justify-center mx-auto mb-6"
    >
      <motion.svg
        width="36" height="36" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        className="text-white"
      >
        <motion.path
          d="M5 13l4 4L19 7"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        />
      </motion.svg>
    </motion.div>
  );
}

// ── CLASS: review before booking ──────────────────────
function ClassConfirmation({ session, instructor }: { session: Session; instructor: Instructor | undefined }) {
  const [confirmed, setConfirmed] = useState(false);
  const location = getLocation(session.locationId);
  const hasMultiplePackages = MOCK_USER.classPackages.length > 1;
  const [selectedPackageId, setSelectedPackageId] = useState(MOCK_USER.classPackages[0]?.id ?? "");
  const selectedPkg = MOCK_USER.classPackages.find((p) => p.id === selectedPackageId) ?? MOCK_USER.classPackages[0];

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

      {/* Class details */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.15 }} className="bg-card border border-border rounded-xl p-6 mb-4">
        <div className="flex items-start gap-3 mb-5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-accent-deep bg-accent-glow/30 px-2 py-0.5 rounded-full">
            {session.category}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted bg-warm px-2 py-0.5 rounded-full border border-border capitalize">
            {session.level === "all" ? "All levels" : session.level}
          </span>
        </div>

        <h2 className="font-serif text-2xl text-ink mb-4">{session.name}</h2>

        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-md bg-warm flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <span className="text-ink">{formatDate(session.date)}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-md bg-warm flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <span className="text-ink">{formatTime(session.time)} · {session.duration} min</span>
          </div>
          {instructor && (
            <div className="flex items-center gap-3 text-sm">
              <div className="w-8 h-8 rounded-md bg-warm flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <span className="text-ink">{instructor.name}</span>
            </div>
          )}
          {location && (
            <div className="flex items-center gap-3 text-sm">
              <div className="w-8 h-8 rounded-md bg-warm flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div>
                <span className="text-ink">{location.name}</span>
                <span className="text-muted text-xs ml-1.5">· {location.area}</span>
              </div>
            </div>
          )}
        </div>

      </motion.div>

      {/* Package selection (if multiple packages) */}
      {hasMultiplePackages && (
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.18 }} className="bg-card border border-border rounded-xl p-5 mb-4">
          <p className="text-sm font-medium text-ink mb-3">Deduct credit from</p>
          <div className="space-y-2">
            {MOCK_USER.classPackages.map((pkg) => (
              <label
                key={pkg.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedPackageId === pkg.id
                    ? "border-sage bg-sage-light/40 shadow-soft"
                    : "border-border hover:bg-warm"
                }`}
              >
                <input
                  type="radio"
                  name="package"
                  value={pkg.id}
                  checked={selectedPackageId === pkg.id}
                  onChange={() => setSelectedPackageId(pkg.id)}
                  className="w-4 h-4 text-sage focus:ring-sage/30 border-border"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{pkg.name}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {pkg.unlimited
                      ? "Unlimited credits"
                      : `${pkg.creditsRemaining} of ${pkg.creditsTotal} credits remaining`}
                    {" · expires "}
                    {new Date(pkg.expiresAt).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <span className="text-sm font-semibold text-sage">{pkg.unlimited ? "∞" : pkg.creditsRemaining}</span>
              </label>
            ))}
          </div>
        </motion.div>
      )}

      {/* Credit summary */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.2 }} className="bg-sage-light border border-sage/20 rounded-xl p-5 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">1 credit will be used</p>
            <p className="text-xs text-muted mt-0.5">
              {selectedPkg
                ? `${selectedPkg.name} · ${selectedPkg.unlimited ? "unlimited" : `${selectedPkg.creditsRemaining - 1} credits remaining`} after booking`
                : `${USER_PACKAGE} · ${USER_CREDITS - 1} credits remaining after booking`}
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-sage/20 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sage">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
      </motion.div>

      {/* Cancellation policy */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.22 }} className="bg-warm border border-border rounded-xl p-4 mb-6 flex gap-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="space-y-1">
          <p className="text-xs font-medium text-ink">Cancellation policy</p>
          <p className="text-xs text-muted">Cancel <span className="font-medium text-ink">more than 3 hours</span> before class — full credit refund.</p>
          <p className="text-xs text-muted">Cancel <span className="font-medium text-ink">within 3 hours</span> — no credit refund.</p>
          <p className="text-xs text-muted mt-1">Repeated last-minute cancellations for the same class may result in a booking restriction.</p>
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
        <Link href="/classes" className="w-full text-center py-3 text-sm text-muted hover:text-ink transition-colors">
          Back to Classes
        </Link>
      </motion.div>

      {/* Success dialog */}
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
              <SuccessIcon />
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.4 }}>
                <h2 className="font-serif text-2xl text-ink mb-3 leading-snug">Your booking is confirmed!</h2>
                <p className="text-sm text-muted mb-5">
                  Please arrive at {location ? <span className="font-semibold text-ink">{location.name}</span> : "the studio"}{" "}
                  <span className="font-semibold text-ink">15 minutes before class</span> to sign in and settle in.
                </p>

                {/* Updated credit balance */}
                <div className="bg-sage-light/60 border border-sage/15 rounded-lg p-3 mb-6">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted">Remaining balance</span>
                    <span className="text-xs font-semibold text-sage">
                      {selectedPkg
                        ? selectedPkg.unlimited ? "Unlimited" : `${selectedPkg.creditsRemaining - 1} credits`
                        : `${USER_CREDITS - 1} credits`}
                    </span>
                  </div>
                  {selectedPkg && !selectedPkg.unlimited ? (
                    <>
                      <div className="w-full h-1.5 rounded-full bg-sage/20 overflow-hidden">
                        <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${((selectedPkg.creditsRemaining - 1) / selectedPkg.creditsTotal) * 100}%` }} />
                      </div>
                      <p className="text-[10px] text-muted mt-1">{selectedPkg.name} · expires {new Date(selectedPkg.expiresAt).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
                    </>
                  ) : (
                    <>
                      <div className="w-full h-1.5 rounded-full bg-sage/20 overflow-hidden">
                        <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${((USER_CREDITS - 1) / MOCK_USER.classPackageTotal) * 100}%` }} />
                      </div>
                      <p className="text-[10px] text-muted mt-1">{USER_PACKAGE} · expires {new Date(MOCK_USER.classPackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
                    </>
                  )}
                </div>

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

// ── WORKSHOP: post-payment success ────────────────────
function WorkshopSuccess({ session, instructor }: { session: Session; instructor: Instructor | undefined }) {
  const location = getLocation(session.locationId);
  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
      <SuccessIcon />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.4 }}>
        <h1 className="font-serif text-3xl text-ink mb-3">You&apos;re registered!</h1>
        <p className="text-sm text-muted mb-8">Your spot has been reserved. A confirmation has been sent to your email.</p>

        <div className="bg-card border border-border rounded-xl p-6 text-left mb-8 space-y-3">
          <h2 className="font-serif text-xl text-ink mb-3">{session.name}</h2>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-7 h-7 rounded-md bg-warm flex items-center justify-center shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <span className="text-ink">{formatDate(session.date)} · {formatTime(session.time)}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-7 h-7 rounded-md bg-warm flex items-center justify-center shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <span className="text-ink">{session.duration} min</span>
          </div>
          {instructor && (
            <div className="flex items-center gap-3 text-sm">
              <div className="w-7 h-7 rounded-md bg-warm flex items-center justify-center shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <span className="text-ink">{instructor.name}</span>
            </div>
          )}
          {location && (
            <div className="flex items-center gap-3 text-sm">
              <div className="w-7 h-7 rounded-md bg-warm flex items-center justify-center shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div>
                <span className="text-ink">{location.name}</span>
                <span className="text-muted text-xs ml-1.5">· {location.area}</span>
              </div>
            </div>
          )}
        </div>

        <Link
          href="/account"
          className="block w-full py-3.5 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors mb-3"
        >
          View My Bookings
        </Link>
        <Link href="/workshops" className="block w-full text-center py-3 text-sm text-muted hover:text-ink transition-colors">
          Browse More Workshops
        </Link>
      </motion.div>
    </div>
  );
}

// ── PACKAGE: post-payment success ─────────────────────
function PackageSuccess({ packageId }: { packageId: string }) {
  const pkg = PACKAGE_DISPLAY[packageId] ?? { name: "Package", subtitle: "Credits added to your account" };

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
      <SuccessIcon />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.4 }}>
        <h1 className="font-serif text-3xl text-ink mb-3">Package activated!</h1>
        <p className="text-sm text-muted mb-8">Your credits are ready to use. An invoice has been sent to your email.</p>

        <div className="bg-sage-light border border-sage/20 rounded-xl p-6 text-left mb-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">{pkg.name}</p>
              <p className="text-xs text-muted mt-0.5">{pkg.subtitle}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-sage/20 flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sage">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        </div>

        <Link
          href="/classes"
          className="block w-full py-3.5 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors mb-3"
        >
          Start Booking Classes
        </Link>
        <Link href="/account/packages" className="block w-full text-center py-3 text-sm text-muted hover:text-ink transition-colors">
          View My Packages
        </Link>
      </motion.div>
    </div>
  );
}

// ── Router ─────────────────────────────────────────────
function ConfirmationContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type");
  const sessionId = searchParams.get("session");
  const packageId = searchParams.get("package");

  // Class booking pre-confirmation (coming from /classes)
  if (type === "class" && sessionId) {
    const session = allSessions.find((s) => s.id === sessionId);
    const instructor = allInstructors.find((i) => i.id === session?.instructorId);
    if (session) {
      return <ClassConfirmation session={session} instructor={instructor} />;
    }
  }

  // Workshop post-payment
  if (type === "workshop" && sessionId) {
    const session = allSessions.find((s) => s.id === sessionId);
    const instructor = allInstructors.find((i) => i.id === session?.instructorId);
    if (session) {
      return <WorkshopSuccess session={session} instructor={instructor} />;
    }
  }

  // Package post-payment
  if (type === "package" && packageId) {
    return <PackageSuccess packageId={packageId} />;
  }

  // Fallback: no params — use first available session as mock
  const fallback = allSessions.find((s) => s.type === "regular" && s.tenantId === "tenant-1");
  const instructor = allInstructors.find((i) => i.id === fallback?.instructorId);
  if (fallback) {
    return <ClassConfirmation session={fallback} instructor={instructor} />;
  }

  // Last resort static fallback
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <p className="text-muted text-sm">Nothing to confirm.</p>
      <Link href="/classes" className="mt-4 inline-block text-sm text-accent hover:underline">Back to Classes</Link>
    </div>
  );
}

export default function BookingConfirmationPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper px-4 py-12 text-muted text-sm">Loading...</div>}>
      <ConfirmationContent />
    </Suspense>
  );
}
