"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Clock, Droplets, Shirt, Check, Info, ArrowLeft, CheckCircle2 } from "lucide-react";
import { formatDate, formatTime, getLocation } from "@/lib/utils";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import { recordBooking, hasActiveUnlimited, useMockState, isExpired, markAttended, type MockPackage } from "@/lib/mock-state";
import { CLASS_CANCELLATION_POLICY } from "@/data/policy";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";

const allSessions = sessionsData as Session[];
const allInstructors = instructorsData as Instructor[];

// ── Mirrors packages/page.tsx and checkout/page.tsx ──────────────────────────
const PACKAGE_DISPLAY: Record<string, { name: string; subtitle: string }> = {
  "b-otp":    { name: "One-time Pass",             subtitle: "1 credit · valid 1 day" },
  "b-10":     { name: "Bundle of 10",               subtitle: "10 credits · valid 90 days" },
  "b-20":     { name: "Bundle of 20",               subtitle: "20 credits · valid 180 days" },
  "b-30":     { name: "Bundle of 30",               subtitle: "30 credits · valid 365 days" },
  "b-50":     { name: "Bundle of 50",               subtitle: "50 credits · valid 365 days" },
  "b-100":    { name: "Bundle of 100",              subtitle: "100 credits · valid 365 days" },
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

// ── What's next tips ──────────────────────────────────────────────────────────
const NEXT_STEPS = [
  {
    icon: Clock,
    heading: "Arrive 10 minutes early",
    body: "Give yourself time to settle in, sign in at the front desk, and prepare your space.",
  },
  {
    icon: Droplets,
    heading: "Bring water and a towel",
    body: "Stay hydrated throughout class. A towel keeps your mat fresh and your practice comfortable.",
  },
  {
    icon: Shirt,
    heading: "Wear comfortable clothing",
    body: "Choose breathable, stretchy fabrics that let you move freely in every pose.",
  },
];

// ── CLASS: review step → success flow ────────────────────────────────────────
function ClassConfirmation({
  session,
  instructor,
  bookingRef,
}: {
  session: Session;
  instructor: Instructor | undefined;
  bookingRef: string;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const location = getLocation(session.locationId);
  const state = useMockState();

  const activeClassPackages: MockPackage[] = state.packages.filter(
    (p) =>
      (p.kind === "class-credit" || p.kind === "class-unlimited") &&
      !isExpired(p) &&
      (p.kind === "class-unlimited" || p.credits > 0)
  );
  const hasMultiplePackages = activeClassPackages.length > 1;
  const [selectedPackageId, setSelectedPackageId] = useState<string>(
    activeClassPackages[0]?.id ?? ""
  );
  const selectedPkg =
    activeClassPackages.find((p) => p.id === selectedPackageId) ??
    activeClassPackages[0];
  const isUnlimitedSelected = selectedPkg?.kind === "class-unlimited";

  function handleReserve() {
    if (typeof window !== "undefined" && sessionStorage.getItem("waiverSigned") !== "true") {
      const returnTo = `/booking/confirmation?type=class&session=${session.id}`;
      router.push(`/waiver?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    recordBooking(
      {
        id: bookingRef,
        sessionId: session.id,
        type: "class",
        bookedAt: new Date().toISOString(),
      },
      {
        decrementCredits: !isUnlimitedSelected && !hasActiveUnlimited(state),
        fromPackageId: selectedPkg?.id,
      }
    );
    setShowDialog(true);
  }

  if (confirmed) {
    return (
      <SessionSuccess
        session={session}
        instructor={instructor}
        bookingRef={bookingRef}
        arrivalLocationName={location?.name}
      />
    );
  }

  return (
    <>
      <BookingSurface maxWidth="md" padding="loose">
        <SectionHeading
          eyebrow="Review & reserve"
          title="Confirm your booking"
          align="center"
        />

        {/* Session details */}
        <div className="text-center">
          <p className="text-2xl font-bold text-ink">{session.name}</p>
          <p className="text-lg text-muted mt-2">
            {formatDate(session.date)} · {formatTime(session.time)}
            {session.duration ? ` · ${session.duration} min` : ""}
          </p>
          {location && (
            <p className="text-sm text-muted mt-1">
              {location.name}
              {location.area ? ` · ${location.area}` : ""}
            </p>
          )}
          {instructor && (
            <p className="text-sm text-muted mt-1">with {instructor.name}</p>
          )}
        </div>

        {/* Package selection (if multiple active packages) */}
        {hasMultiplePackages && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-5">
            <p className="text-sm font-semibold text-ink mb-1">
              Deduct credit from
            </p>
            <p className="text-xs text-muted mb-3">
              Choose which package to use for this booking
            </p>
            <div className="space-y-2">
              {activeClassPackages.map((pkg) => {
                const selected = selectedPackageId === pkg.id;
                const isUnlimited = pkg.kind === "class-unlimited";
                return (
                  <label
                    key={pkg.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      selected
                        ? "border-sage bg-sage/10 shadow-soft"
                        : "border-border hover:bg-warm"
                    }`}
                  >
                    <input
                      type="radio"
                      name="package"
                      value={pkg.id}
                      checked={selected}
                      onChange={() => setSelectedPackageId(pkg.id)}
                      className="w-4 h-4 accent-sage border-border"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink">{pkg.name}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {isUnlimited
                          ? "Unlimited credits"
                          : `${pkg.credits} of ${pkg.totalCredits} credits remaining`}
                        {" · expires "}
                        {new Date(pkg.expiresAt).toLocaleDateString("en-SG", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Credit summary */}
        <div className="mt-4 rounded-2xl border border-sage/20 bg-sage/10 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {isUnlimitedSelected
                  ? "Unlimited classes — no credit deducted"
                  : "1 credit will be used"}
              </p>
              <p className="text-xs text-muted mt-0.5">
                {selectedPkg
                  ? isUnlimitedSelected
                    ? `${selectedPkg.name} · unlimited bookings until ${new Date(selectedPkg.expiresAt).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}`
                    : `${selectedPkg.name} · ${Math.max(selectedPkg.credits - 1, 0)} credits remaining after booking`
                  : "No active package — please purchase credits first"}
              </p>
            </div>
            <div className="w-10 h-10 shrink-0 rounded-full bg-sage/20 flex items-center justify-center">
              <Check size={18} className="text-sage" strokeWidth={2} />
            </div>
          </div>
        </div>

        {/* Cancellation policy */}
        <div className="mt-4 rounded-2xl border border-border bg-warm p-4 flex gap-3">
          <Info size={16} className="text-muted shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink">Cancellation policy</p>
            <p className="text-xs text-muted">
              Cancel{" "}
              <span className="font-medium text-ink">more than {CLASS_CANCELLATION_POLICY.window}</span>{" "}
              before class — full credit refund.
            </p>
            <p className="text-xs text-muted">
              Cancel <span className="font-medium text-ink">within {CLASS_CANCELLATION_POLICY.window}</span>{" "}
              — no credit refund.
            </p>
            <p className="text-xs text-muted mt-1">
              {CLASS_CANCELLATION_POLICY.repeat}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={handleReserve}
            className="w-full py-3.5 text-sm font-semibold text-paper bg-accent rounded-full hover:bg-accent-deep transition-colors shadow-soft hover:shadow-hover active:scale-[0.99]"
          >
            Reserve Now
          </button>
          <Link
            href="/classes"
            className="w-full text-center py-3 text-sm text-muted hover:text-ink transition-colors"
          >
            Back to Classes
          </Link>
        </div>
      </BookingSurface>

      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
          <div className="bg-paper rounded-2xl p-8 max-w-md w-full shadow-modal text-center">
            <div className="w-16 h-16 rounded-full bg-sage/15 flex items-center justify-center mx-auto mb-5">
              <Check size={30} className="text-sage" strokeWidth={2.5} />
            </div>
            <h1 className="font-serif text-2xl text-ink leading-snug">
              Your booking is confirmed! Please arrive 15 minutes before class
            </h1>
            <button
              onClick={() => {
                setShowDialog(false);
                setConfirmed(true);
              }}
              className="mt-8 w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent-deep transition-colors"
            >
              I will attend on time
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Session-based success (class or workshop) ─────────────────────────────────
function SessionSuccess({
  session,
  instructor,
  bookingRef,
  arrivalLocationName,
  bookingType = "class",
}: {
  session: Session;
  instructor: Instructor | undefined;
  bookingRef: string;
  arrivalLocationName?: string;
  bookingType?: "class" | "workshop" | "private";
}) {
  const router = useRouter();
  const state = useMockState();
  const location = getLocation(session.locationId);
  const studioName = arrivalLocationName ?? location?.name;
  const attended = state.attendedBookings.includes(bookingRef);
  const bookingsHref =
    bookingType === "workshop" ? "/account/workshops" :
    bookingType === "private" ? "/account/private-sessions" :
    "/account/classes";

  return (
    <>
      {/* 2. Summary */}
      <div id="summary">
        <BookingSurface maxWidth="md" padding="loose">
          <SectionHeading
            eyebrow="Your booking"
            title="Session details"
            align="center"
          />

          {/* Details stack */}
          <div className="text-center">
            <p className="text-2xl font-bold text-ink">{session.name}</p>
            <p className="text-lg text-muted mt-2">
              {formatDate(session.date)} · {formatTime(session.time)}
              {session.duration ? ` · ${session.duration} min` : ""}
            </p>
            {location && (
              <p className="text-sm text-muted mt-1">
                {location.name}
                {location.area ? ` · ${location.area}` : ""}
              </p>
            )}
            {instructor && (
              <p className="text-sm text-muted mt-1">with {instructor.name}</p>
            )}
          </div>

          {/* Action row */}
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-2 rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <Link
              href={bookingsHref}
              className="inline-flex items-center gap-2 rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
            >
              Show my bookings
            </Link>
            <button
              onClick={() => {
                markAttended(bookingRef);
                router.back();
              }}
              disabled={attended}
              className="inline-flex items-center gap-2 rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              Attended (Demo Only)
            </button>
          </div>
        </BookingSurface>
      </div>

      {/* 3. What's next */}
      <section className="bg-paper py-16">
        <div className="max-w-5xl mx-auto px-6">
          <SectionHeading
            align="center"
            eyebrow="What's next"
            title="Before your class"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {NEXT_STEPS.map(({ icon: Icon, heading, body }, idx) => {
              const resolvedBody =
                idx === 0 && studioName
                  ? `Please arrive at ${studioName} 15 minutes before class to sign in and settle in.`
                  : body;
              return (
                <div
                  key={heading}
                  className="rounded-2xl bg-card border border-ink/10 p-6 text-center"
                >
                  <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                    <Icon size={28} className="text-accent" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-base font-semibold text-ink mb-2">
                    {heading}
                  </h3>
                  <p className="text-sm text-muted leading-relaxed">
                    {resolvedBody}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

    </>
  );
}

// ── Package post-payment success (preserved) ──────────────────────────────────
function PackageSuccess({ packageId }: { packageId: string }) {
  const pkg =
    PACKAGE_DISPLAY[packageId] ?? {
      name: "Package",
      subtitle: "Credits added to your account",
    };

  const isPrivatePackage = packageId.startsWith("p1-") || packageId.startsWith("p2-");
  const ctaHref = isPrivatePackage ? "/private-sessions" : "/classes";
  const ctaLabel = isPrivatePackage
    ? "Start Booking Private Sessions"
    : "Start Booking Classes";
  const bannerLabel = isPrivatePackage ? "Browse private sessions" : "Browse classes";
  const bannerSub = isPrivatePackage
    ? "Schedule your next 1-on-1 while you're here."
    : "Book your next class while you're here.";

  return (
    <>
      {/* Summary */}
      <div id="summary">
        <BookingSurface maxWidth="md" padding="loose">
          <SectionHeading
            eyebrow="Your purchase"
            title="Package details"
            align="center"
          />

          <div className="text-center">
            <p className="text-2xl font-bold text-ink">{pkg.name}</p>
            <p className="text-lg text-muted mt-2">{pkg.subtitle}</p>
          </div>

          <div className="mt-10 flex gap-3 justify-center">
            <Link
              href={ctaHref}
              className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
            >
              {ctaLabel}
            </Link>
            <Link
              href="/account"
              className="rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors"
            >
              View my account
            </Link>
          </div>
        </BookingSurface>
      </div>

    </>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
function ConfirmationContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type");
  const sessionId = searchParams.get("session");
  const packageId = searchParams.get("package");
  const alreadyConfirmed = searchParams.get("confirmed") === "1";

  // Generate a booking reference for QR from URL params or a stable mock
  const bookingRef = sessionId
    ? `YS-BOOKING-${sessionId.toUpperCase()}`
    : "YS-BOOKING-MOCK";

  // Class booking: review step → success (or skip to success when already booked)
  if (type === "class" && sessionId) {
    const session = allSessions.find((s) => s.id === sessionId);
    const instructor = allInstructors.find(
      (i) => i.id === session?.instructorId
    );
    if (session) {
      if (alreadyConfirmed) {
        return (
          <SessionSuccess
            session={session}
            instructor={instructor}
            bookingRef={bookingRef}
            bookingType="class"
          />
        );
      }
      return (
        <ClassConfirmation
          session={session}
          instructor={instructor}
          bookingRef={bookingRef}
        />
      );
    }
  }

  // Workshop post-payment success
  if (type === "workshop" && sessionId) {
    const session = allSessions.find((s) => s.id === sessionId);
    const instructor = allInstructors.find(
      (i) => i.id === session?.instructorId
    );
    if (session) {
      return (
        <SessionSuccess
          session={session}
          instructor={instructor}
          bookingRef={bookingRef}
          bookingType="workshop"
        />
      );
    }
  }

  // Private session
  if (type === "private" && sessionId) {
    const session = allSessions.find((s) => s.id === sessionId);
    const instructor = allInstructors.find(
      (i) => i.id === session?.instructorId
    );
    if (session) {
      return (
        <SessionSuccess
          session={session}
          instructor={instructor}
          bookingRef={bookingRef}
          bookingType="private"
        />
      );
    }
  }

  // Package post-payment success
  if (type === "package" && packageId) {
    return <PackageSuccess packageId={packageId} />;
  }

  // Fallback: use first available session as mock
  const fallback = allSessions.find(
    (s) => s.type === "regular" && s.tenantId === "tenant-1"
  );
  const instructor = allInstructors.find(
    (i) => i.id === fallback?.instructorId
  );
  if (fallback) {
    return (
      <SessionSuccess
        session={fallback}
        instructor={instructor}
        bookingRef="YS-BOOKING-DEMO"
      />
    );
  }

  // Last resort
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <p className="text-muted text-sm">Nothing to confirm.</p>
      <Link
        href="/classes"
        className="mt-4 inline-block text-sm text-accent hover:underline"
      >
        Back to Classes
      </Link>
    </div>
  );
}

export default function BookingConfirmationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-paper px-4 py-12 text-muted text-sm">
          Loading...
        </div>
      }
    >
      <ConfirmationContent />
    </Suspense>
  );
}
