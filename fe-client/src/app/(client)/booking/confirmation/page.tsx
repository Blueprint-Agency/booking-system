"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { fetchApi } from "@/lib/api-url";
import { Check } from "lucide-react";
import { useClientPackages } from "@/lib/use-client-packages";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";

function Spinner() {
  return (
    <svg className="w-8 h-8 text-accent animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
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
        await fetchApi("/me/checkout/sync-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: stripeSessionId }),
        });
      } catch { /* non-fatal — webhook delivery still grants the booking */ }
      if (!cancelled) setSynced(true);
    })();
    return () => { cancelled = true; };
  }, [stripeSessionId, getToken]);

  useEffect(() => {
    let cancelled = false;
    fetchApi(`/public/workshops/${workshopId}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setWorkshop(data); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [workshopId]);

  const dateLine = workshop?.starts_at
    ? new Date(workshop.starts_at).toLocaleString("en-SG", {
        weekday: "short", day: "numeric", month: "short",
        hour: "numeric", minute: "2-digit",
        timeZone: "Asia/Singapore",
      })
    : null;

  return (
    <div id="summary">
      <BookingSurface maxWidth="md" padding="loose">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
            {synced ? <Check className="w-8 h-8 text-accent" /> : <Spinner />}
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
            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center text-center">
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

// ── Merch post-payment success ────────────────────────────────────────────────
function MerchSuccess({ stripeSessionId }: { stripeSessionId: string | null }) {
  const { getToken } = useAuth();
  const [synced, setSynced] = useState(false);

  // Same sync as the other flows: record the order immediately rather than
  // waiting on webhook delivery (no CLI listener in local dev).
  useEffect(() => {
    if (!stripeSessionId) { setSynced(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        await fetchApi("/me/checkout/sync-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: stripeSessionId }),
        });
      } catch { /* non-fatal — webhook delivery still records the order */ }
      if (!cancelled) setSynced(true);
    })();
    return () => { cancelled = true; };
  }, [stripeSessionId, getToken]);

  return (
    <div id="summary">
      <BookingSurface maxWidth="md" padding="loose">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
            {synced ? <Check className="w-8 h-8 text-accent" /> : <Spinner />}
          </div>
          <p className="text-sm uppercase tracking-wider text-muted mb-1">Payment successful</p>
          <h1 className="font-serif text-3xl text-ink">
            {synced ? "Thank you!" : "Recording your order…"}
          </h1>
        </div>

        {synced && (
          <>
            <div className="text-center">
              <p className="text-lg text-muted">
                We&apos;ll hand your merch over to you physically at the studio — just ask
                at the front desk on your next visit. Nothing is shipped.
              </p>
            </div>
            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center text-center">
              <Link
                href="/account/merch"
                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
              >
                View my purchases
              </Link>
              <Link
                href="/merch"
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
type PackageKind = "class" | "pt";

// Real catalogue details for the just-purchased item, fetched from the public
// catalogue so the overlay reflects exactly what was bought.
type PackageDetails =
  | { kind: "class"; subKind: "credit_bundle" | "unlimited" | "trial"; name: string; credits: number }
  | { kind: "pt"; name: string; numSessions: number };

// The overlay's copy + CTAs, derived so each purchase type reads relevantly.
function buildPackageView(packageKind: PackageKind, details: PackageDetails | null) {
  if (packageKind === "pt") {
    const sessions = details?.kind === "pt" ? details.numSessions : undefined;
    return {
      title: "Package details",
      name: (details?.kind === "pt" ? details.name : undefined) ?? "Private session package",
      subtitle: sessions != null
        ? `${sessions} private session${sessions === 1 ? "" : "s"} added to your account`
        : "Your private sessions have been added to your account",
      primary: { href: "/private-sessions", label: "Start Booking Private Sessions" },
      secondary: { href: "/account", label: "View my account" },
    };
  }

  // class — credit bundle, trial, or unlimited pass
  const isUnlimited = details?.kind === "class" && details.subKind === "unlimited";
  const credits = details?.kind === "class" ? details.credits : undefined;
  return {
    title: "Package details",
    name: (details?.kind === "class" ? details.name : undefined) ?? "Package",
    subtitle: isUnlimited
      ? "Your unlimited pass is now active — book any class, anytime."
      : credits != null
        ? `${credits} class credit${credits === 1 ? "" : "s"} added to your account`
        : "Credits have been added to your account",
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
  // reflect the purchase without a manual page refresh.
  useEffect(() => {
    if (!stripeSessionId) { setSynced(true); void refetch(); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        await fetchApi("/me/checkout/sync-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: stripeSessionId }),
        });
      } catch { /* non-fatal — webhook delivery still grants the package */ }
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
        const res = await fetchApi("/public/packages");
        const data = await res.json();
        const cls = data.class_packages?.find((p: { id: string }) => p.id === packageId);
        if (cls) {
          if (!cancelled) setDetails({ kind: "class", subKind: cls.kind, name: cls.name, credits: cls.credits });
          return;
        }
        const pt = data.pt_packages?.find((p: { id: string }) => p.id === packageId);
        if (pt && !cancelled) setDetails({ kind: "pt", name: pt.name, numSessions: pt.num_sessions });
      } catch { /* non-fatal — falls back to generic copy */ }
    })();
    return () => { cancelled = true; };
  }, [packageId, packageKind]);

  const view = buildPackageView(packageKind, details);

  return (
    <div id="summary">
      <BookingSurface maxWidth="md" padding="loose">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
            {synced ? <Check className="w-8 h-8 text-accent" /> : <Spinner />}
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
            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center text-center">
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
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
function ConfirmationContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type");
  // `session_id` = Stripe Checkout Session ID (cs_...), present on paid flows.
  const stripeSessionId = searchParams.get("session_id");
  const packageId = searchParams.get("package_id");
  const packageKind = (searchParams.get("package_kind") ?? "class") as PackageKind;

  // Workshop success — Stripe success_url redirect (paid) or BuyButton (free):
  //   type=workshop, workshop_id=<uuid> [, session_id=cs_... | booking_id=<uuid>]
  const workshopId = searchParams.get("workshop_id");
  if (type === "workshop" && workshopId) {
    return <WorkshopSuccess workshopId={workshopId} stripeSessionId={stripeSessionId} />;
  }

  // Merch success — Stripe success_url redirect (paid) or BuyButton (free item):
  //   type=merch [, session_id=cs_...]
  if (type === "merch") {
    return <MerchSuccess stripeSessionId={stripeSessionId} />;
  }

  // Package success — Stripe success_url redirect (paid) or BuyButton (free trial):
  //   type=package, package_id=<uuid>, package_kind=class|pt [, session_id=cs_...]
  if (type === "package" && packageId) {
    return <PackageSuccess packageId={packageId} packageKind={packageKind} stripeSessionId={stripeSessionId} />;
  }

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
