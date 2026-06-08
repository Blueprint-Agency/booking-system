"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { getApiBaseUrl } from "@/lib/api-url";
import { Clock, Droplets, Shirt, Check, Info, ArrowLeft, CheckCircle2 } from "lucide-react";
import { formatDate, formatTime, getLocation } from "@/lib/utils";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import { recordBooking, hasActiveUnlimited, useMockState, isExpired, markAttended, type MockPackage } from "@/lib/mock-state";
import { useClientPackages } from "@/lib/use-client-packages";
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

// ── Workshop post-payment success ─────────────────────────────────────────────
function WorkshopSuccess({
  workshopId,
  stripeSessionId,
}: {
  workshopId: string;
  stripeSessionId: string | null;
}) {
  const { getToken } = useAuth();
  const [synced, setSynced] = useState(false);
  const [workshop, setWorkshop] = useState<{
    name: string;
    starts_at: string | null;
    location: { name: string; address: string | null } | null;
  } | null>(null);

  // Sync the Stripe session server-side so the booking row is created immediately
  // even if the local Stripe CLI webhook listener isn't running.
  useEffect(() => {
    if (!stripeSessionId) { setSynced(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        await fetch(`${getApiBaseUrl()}/me/checkout/sync-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: stripeSessionId }),
        });
      } catch { /* non-fatal */ }
      if (!cancelled) setSynced(true);
    })();
    return () => { cancelled = true; };
  }, [stripeSessionId, getToken]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBaseUrl()}/public/workshops/${workshopId}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setWorkshop(data); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [workshopId]);

  const dateLine = workshop?.starts_at
    ? new Date(workshop.starts_at).toLocaleString(undefined, {
        weekday: "short", day: "numeric", month: "short",
        hour: "numeric", minute: "2-digit",
      })
    : null;

  return (
    <div id="summary">
      <BookingSurface maxWidth="md" padding="loose">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
            {synced
              ? <Check className="w-8 h-8 text-accent" />
              : <svg className="w-8 h-8 text-accent animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            }
          </div>
          <p className="text-sm uppercase tracking-wider text-muted mb-1">Payment successful</p>
          <h1 className="font-serif text-3xl text-ink">
            {synced ? "You're booked!" : "Confirming your booking…"}
          </h1>
        </div>

        {synced && workshop && (
          <>
            <SectionHeading eyebrow="Your workshop" title="Booking details" align="center" />
            <div className="text-center">
              <p className="text-2xl font-bold text-ink">{workshop.name}</p>
              {dateLine && <p className="text-lg text-muted mt-2">{dateLine}</p>}
              {workshop.location && (
                <p className="text-sm text-muted mt-1">
                  {workshop.location.name}
                  {workshop.location.address ? ` · ${workshop.location.address}` : ""}
                </p>
              )}
            </div>
            <div className="mt-10 flex gap-3 justify-center">
              <Link
                href="/account/workshops"
                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
              >
                View my workshops
              </Link>
              <Link
                href="/workshops"
                className="rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors"
              >
                Browse more
              </Link>
            </div>
          </>
        )}
      </BookingSurface>
    </div>
  );
}

// ── Package post-payment success ──────────────────────────────────────────────
type PackageKind = "class" | "pt" | "corporate";

// Real catalogue details for the just-purchased item, fetched from the public
// catalogue so the overlay reflects exactly what was bought (live packages use
// UUIDs, so the legacy PACKAGE_DISPLAY slug map can't cover them).
type PackageDetails =
  | { kind: "class"; subKind: "credit_bundle" | "unlimited"; name: string; credits: number }
  | { kind: "pt"; name: string; numSessions: number }
  | { kind: "corporate"; name: string };

// The overlay's copy + CTAs, derived so each purchase type reads relevantly.
function buildPackageView(
  packageKind: PackageKind,
  details: PackageDetails | null,
  legacy: { name: string; subtitle: string } | undefined,
) {
  if (packageKind === "corporate") {
    return {
      title: "Corporate package",
      name: (details?.kind === "corporate" ? details.name : undefined) ?? legacy?.name ?? "Corporate package",
      subtitle: "Thanks for your purchase. Our team will be in touch to set up your corporate plan.",
      primary: { href: "/account/corporate", label: "View corporate packages" },
      secondary: { href: "/account", label: "View my account" },
    };
  }

  if (packageKind === "pt") {
    const sessions = details?.kind === "pt" ? details.numSessions : undefined;
    return {
      title: "Package details",
      name: (details?.kind === "pt" ? details.name : undefined) ?? legacy?.name ?? "Private session package",
      subtitle: sessions != null
        ? `${sessions} private session${sessions === 1 ? "" : "s"} added to your account`
        : "Your private sessions have been added to your account",
      primary: { href: "/private-sessions", label: "Start Booking Private Sessions" },
      secondary: { href: "/account", label: "View my account" },
    };
  }

  // class — credit bundle or unlimited pass
  const isUnlimited = details?.kind === "class" && details.subKind === "unlimited";
  const credits = details?.kind === "class" ? details.credits : undefined;
  return {
    title: "Package details",
    name: (details?.kind === "class" ? details.name : undefined) ?? legacy?.name ?? "Package",
    subtitle: isUnlimited
      ? "Your unlimited pass is now active — book any class, anytime."
      : credits != null
        ? `${credits} class credit${credits === 1 ? "" : "s"} added to your account`
        : legacy?.subtitle ?? "Credits have been added to your account",
    primary: { href: "/classes", label: "Start Booking Classes" },
    secondary: { href: "/account", label: "View my account" },
  };
}

function PackageSuccess({
  packageId,
  packageKind,
  stripeSessionId,
}: {
  packageId: string;
  packageKind: PackageKind;
  stripeSessionId: string | null;
}) {
  const { getToken } = useAuth();
  const { refetch } = useClientPackages();
  const [synced, setSynced] = useState(false);
  const [details, setDetails] = useState<PackageDetails | null>(null);

  // Sync the Stripe session server-side so credits are granted immediately
  // without waiting for the webhook (handles local dev where no CLI listener runs),
  // then refetch the live packages so the header/account credit + session totals
  // reflect the purchase without a manual page refresh. (The provider's
  // pathname-based refetch races ahead of sync-session and would read stale data.)
  useEffect(() => {
    if (!stripeSessionId) { setSynced(true); void refetch(); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        await fetch(`${getApiBaseUrl()}/me/checkout/sync-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: stripeSessionId }),
        });
      } catch { /* non-fatal */ }
      if (!cancelled) {
        setSynced(true);
        await refetch();
      }
    })();
    return () => { cancelled = true; };
  }, [stripeSessionId, getToken, refetch]);

  // Pull the real catalogue entry so the overlay copy matches what was bought.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (packageKind === "corporate") {
          const res = await fetch(`${getApiBaseUrl()}/public/corporate-packages`);
          const data = await res.json();
          const row = data.corporate_packages?.find((p: { id: string }) => p.id === packageId);
          if (!cancelled && row) setDetails({ kind: "corporate", name: row.name });
          return;
        }
        const res = await fetch(`${getApiBaseUrl()}/public/packages`);
        const data = await res.json();
        const cls = data.class_packages?.find((p: { id: string }) => p.id === packageId);
        if (cls) {
          if (!cancelled) setDetails({ kind: "class", subKind: cls.kind, name: cls.name, credits: cls.credits });
          return;
        }
        const pt = data.pt_packages?.find((p: { id: string }) => p.id === packageId);
        if (pt && !cancelled) setDetails({ kind: "pt", name: pt.name, numSessions: pt.num_sessions });
      } catch { /* non-fatal — falls back to legacy/ generic copy */ }
    })();
    return () => { cancelled = true; };
  }, [packageId, packageKind]);

  const view = buildPackageView(packageKind, details, PACKAGE_DISPLAY[packageId]);

  return (
    <>
      <div id="summary">
        <BookingSurface maxWidth="md" padding="loose">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
              {synced
                ? <Check className="w-8 h-8 text-accent" />
                : <svg className="w-8 h-8 text-accent animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              }
            </div>
            <p className="text-sm uppercase tracking-wider text-muted mb-1">Payment successful</p>
            <h1 className="font-serif text-3xl text-ink">
              {synced ? "You're all set!" : "Activating your package…"}
            </h1>
          </div>

          {synced && (
            <>
              <SectionHeading eyebrow="Your purchase" title={view.title} align="center" />
              <div className="text-center">
                <p className="text-2xl font-bold text-ink">{view.name}</p>
                <p className="text-lg text-muted mt-2">{view.subtitle}</p>
              </div>
              <div className="mt-10 flex gap-3 justify-center">
                <Link
                  href={view.primary.href}
                  className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
                >
                  {view.primary.label}
                </Link>
                <Link
                  href={view.secondary.href}
                  className="rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors"
                >
                  {view.secondary.label}
                </Link>
              </div>
            </>
          )}
        </BookingSurface>
      </div>
    </>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
function ConfirmationContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type");
  // `session` = class/workshop booking ID; `session_id` = Stripe Checkout Session ID
  const sessionId = searchParams.get("session");
  const stripeSessionId = searchParams.get("session_id"); // cs_test_...
  // Legacy slug-based param (mock links) OR real UUID-based param from Stripe success_url
  const packageId = searchParams.get("package_id") ?? searchParams.get("package");
  const packageKind = (searchParams.get("package_kind") ?? "class") as PackageKind;
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

  // Workshop post-payment success — triggered by Stripe success_url redirect
  // params: type=workshop, workshop_id=<uuid>, session_id=cs_... (paid)
  //  OR    : type=workshop, workshop_id=<uuid>, booking_id=<uuid>   (free)
  const workshopId = searchParams.get("workshop_id");
  if (type === "workshop" && workshopId) {
    return <WorkshopSuccess workshopId={workshopId} stripeSessionId={stripeSessionId} />;
  }

  // Legacy mock workshop link (kept for the demo `?type=workshop&session=<sessionId>`).
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

  // Package post-payment success — triggered by Stripe success_url redirect
  // params: type=package, package_id=<uuid>, package_kind=class|pt, session_id=cs_...
  if (type === "package" && packageId) {
    return <PackageSuccess packageId={packageId} packageKind={packageKind} stripeSessionId={stripeSessionId} />;
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
