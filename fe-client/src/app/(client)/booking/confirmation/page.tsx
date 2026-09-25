"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getMemberToken } from "@/lib/member-auth";
import { fetchApi } from "@/lib/api-url";
import { Check } from "lucide-react";
import { useClientPackages } from "@/lib/use-client-packages";
import { OpenPurchases } from "@/components/account/open-purchases";
import { usePartPaymentOptions, type OpenPurchase } from "@/lib/open-purchases";
import { reportError } from "@/lib/report-error";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import {
  confirmationEyebrow,
  confirmationOutcome,
  PENDING_BODY,
  PENDING_HEADING,
  type ConfirmationOutcome,
  type SyncResult,
} from "@/lib/checkout-return";

function Spinner() {
  return (
    <svg className="w-8 h-8 text-accent animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── The sync every paid flow does on landing ─────────────────────────────────
/**
 * Record the provider's session now rather than waiting on webhook delivery
 * (no CLI listener in local dev), and say what it answered (#274).
 *
 * Null while it runs. After that, only `confirmed` may be called a payment: a
 * session the provider has not marked paid, or a sync that failed, is
 * `pending` — the webhook still records a real payment, so it is never shown as
 * a failure either — and no session at all is a $0 grant, `free`.
 */
function useCheckoutSync(stripeSessionId: string | null): ConfirmationOutcome | null {
  const getToken = getMemberToken;
  const [outcome, setOutcome] = useState<ConfirmationOutcome | null>(
    stripeSessionId ? null : "free",
  );

  useEffect(() => {
    if (!stripeSessionId) return;
    let cancelled = false;
    (async () => {
      let sync: SyncResult;
      try {
        const token = await getToken();
        const res = await fetchApi("/me/checkout/sync-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: stripeSessionId }),
        });
        sync = { ok: res.ok, body: await res.json().catch(() => null) };
      } catch (err) {
        reportError(err, { scope: "checkout-sync" });
        sync = "failed";
      }
      if (!cancelled) setOutcome(confirmationOutcome(stripeSessionId, sync));
    })();
    return () => { cancelled = true; };
  }, [stripeSessionId, getToken]);

  return outcome;
}

/** The icon, eyebrow and heading every confirmation opens with. */
function ConfirmationHeader({
  outcome,
  syncingHeading,
  doneHeading,
}: {
  outcome: ConfirmationOutcome | null;
  syncingHeading: string;
  doneHeading: string;
}) {
  return (
    <div className="text-center mb-6">
      <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
        {outcome === null || outcome === "pending" ? <Spinner /> : <Check className="w-8 h-8 text-accent" />}
      </div>
      {outcome !== null && (
        <p className="text-sm uppercase tracking-wider text-muted mb-1">{confirmationEyebrow(outcome)}</p>
      )}
      <h1 className="font-serif text-3xl text-ink">
        {outcome === null ? syncingHeading : outcome === "pending" ? PENDING_HEADING : doneHeading}
      </h1>
    </div>
  );
}

/** The body of the pending state: what to expect, and where to look. */
function PendingNotice() {
  return (
    <>
      <p className="text-center text-lg text-muted">{PENDING_BODY}</p>
      <div className="mt-10 flex justify-center">
        <Link
          href="/account"
          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
        >
          View my account
        </Link>
      </div>
    </>
  );
}

/** Settled — confirmed or free — as opposed to still syncing or pending. */
const settled = (outcome: ConfirmationOutcome | null) => outcome === "confirmed" || outcome === "free";

// ── Workshop post-payment success ─────────────────────────────────────────────
function WorkshopSuccess({
  workshopId,
  stripeSessionId,
}: {
  workshopId: string;
  stripeSessionId: string | null;
}) {
  const outcome = useCheckoutSync(stripeSessionId);
  const [workshop, setWorkshop] = useState<{
    name: string;
    starts_at: string | null;
    location: { name: string; address: string | null } | null;
  } | null>(null);

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
        <ConfirmationHeader
          outcome={outcome}
          syncingHeading="Confirming your booking…"
          doneHeading="You're booked!"
        />

        {outcome === "pending" && <PendingNotice />}

        {settled(outcome) && workshop && (
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
  const outcome = useCheckoutSync(stripeSessionId);

  return (
    <div id="summary">
      <BookingSurface maxWidth="md" padding="loose">
        <ConfirmationHeader
          outcome={outcome}
          syncingHeading="Recording your purchase…"
          doneHeading="Thank you!"
        />

        {outcome === "pending" && <PendingNotice />}

        {settled(outcome) && (
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

// ── Cross-Location Add-On bought on its own ──────────────────────────────────
/**
 * Where the standalone Add-On lands (#274). It used to fall through to
 * "Nothing to confirm", which reads as the purchase having gone nowhere.
 */
function CrossLocationSuccess({ stripeSessionId }: { stripeSessionId: string | null }) {
  const outcome = useCheckoutSync(stripeSessionId);
  const { refetch } = useClientPackages();

  // The plan card and the class list read the Add-On off the member's packages,
  // so refresh them once it is recorded rather than on the next page load.
  useEffect(() => {
    if (outcome === "confirmed") void refetch();
  }, [outcome, refetch]);

  return (
    <div id="summary">
      <BookingSurface maxWidth="md" padding="loose">
        <ConfirmationHeader
          outcome={outcome}
          syncingHeading="Activating your add-on…"
          doneHeading="Add-on active"
        />

        {outcome === "pending" && <PendingNotice />}

        {settled(outcome) && (
          <>
            <p className="text-center text-lg text-muted">
              You can now book at other locations. The add-on ends with the plan it&apos;s
              attached to.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center text-center">
              <Link
                href="/classes"
                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
              >
                Start Booking Classes
              </Link>
              <Link
                href="/account"
                className="rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors"
              >
                View my account
              </Link>
            </div>
          </>
        )}
      </BookingSurface>
    </div>
  );
}

// ── Part payment: what is still owed ─────────────────────────────────────────
/**
 * Where a part payment lands (#93).
 *
 * It cannot say "you're all set", because it does not know that it is: the
 * payment may have cleared the balance or may have left some of it. So it syncs
 * the session, asks the server what is still outstanding, and prints the
 * answer — a remaining balance with the next card offered, or the plain fact
 * that everything is paid and delivered.
 *
 * Asking rather than assuming is the whole point. The member typed an amount
 * against a price the browser worked out; only the server knows what the
 * provider actually captured against a balance it owns.
 */
function BalanceSuccess({ stripeSessionId }: { stripeSessionId: string | null }) {
  const getToken = getMemberToken;
  const { refetch: refetchPackages } = useClientPackages();
  const partPayment = usePartPaymentOptions();
  // What this session left owing, or nothing, or "not confirmed yet" — which
  // also covers a sync that failed. That last must never be shown as the
  // second, and never as a payment received (#274) — see the sync below.
  const [outcome, setOutcome] = useState<
    | { kind: "syncing" }
    | { kind: "pending" }
    | { kind: "settled" }
    | { kind: "owing"; purchase: OpenPurchase }
  >({ kind: "syncing" });

  // The same sync every other flow does — record the payment now rather than
  // waiting on webhook delivery. It answers with **this session's** Purchase,
  // which is the only thing that can say whether the payment just made finished
  // the job: a member may hold a second unfinished purchase for something else
  // entirely, and "does this member owe anything" would answer about that one.
  useEffect(() => {
    if (!stripeSessionId) { setOutcome({ kind: "pending" }); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetchApi("/me/checkout/sync-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: stripeSessionId }),
        });
        if (!res.ok) throw new Error(`sync failed: ${res.status}`);
        const data: { status?: string; purchase?: OpenPurchase | null } = await res.json();
        if (cancelled) return;
        // A session the provider has not marked paid carries no Purchase, and
        // reading that absence as "nothing owed" told a member it was settled.
        if (confirmationOutcome(stripeSessionId, { ok: true, body: data }) === "pending") {
          setOutcome({ kind: "pending" });
        } else {
          setOutcome(data.purchase ? { kind: "owing", purchase: data.purchase } : { kind: "settled" });
        }
      } catch (err) {
        // The money is safe — the webhook records it whatever happens here —
        // but we do not know what was taken or what is left. Saying "all set"
        // on a failed read is how a member who owes half is told they owe
        // nothing, and "received" claims a payment nobody confirmed (#274).
        reportError(err, { scope: "balance-confirmation" });
        if (!cancelled) setOutcome({ kind: "pending" });
      }
      if (!cancelled) await refetchPackages();
    })();
    return () => { cancelled = true; };
  }, [stripeSessionId, getToken, refetchPackages]);

  const done = outcome.kind === "settled" || outcome.kind === "owing";

  return (
    <div id="summary">
      <BookingSurface maxWidth="md" padding="loose">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
            {done ? <Check className="w-8 h-8 text-accent" /> : <Spinner />}
          </div>
          {outcome.kind !== "syncing" && (
            <p className="text-sm uppercase tracking-wider text-muted mb-1">
              {done ? "Part payment received" : confirmationEyebrow("pending")}
            </p>
          )}
          <h1 className="font-serif text-3xl text-ink">
            {outcome.kind === "syncing"
              ? "Recording your payment…"
              : outcome.kind === "pending"
                ? PENDING_HEADING
                : outcome.kind === "settled"
                  ? "You're all set!"
                  : "Thanks — here's what's left"}
          </h1>
        </div>

        {outcome.kind === "pending" && <PendingNotice />}

        {outcome.kind === "settled" && (
          <>
            <p className="text-center text-lg text-muted">
              That cleared the balance. Everything you bought is on your account.
            </p>
            <div className="mt-10 flex justify-center">
              <Link
                href="/account"
                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
              >
                View my account
              </Link>
            </div>
          </>
        )}

        {outcome.kind === "owing" && (
          <OpenPurchases purchases={[outcome.purchase]} partPayment={partPayment} />
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
  const outcome = useCheckoutSync(stripeSessionId);
  const { refetch } = useClientPackages();
  const [details, setDetails] = useState<PackageDetails | null>(null);

  // Refetch the live packages once the purchase is recorded, so the
  // header/account credit + session totals reflect it without a manual refresh.
  useEffect(() => {
    if (settled(outcome)) void refetch();
  }, [outcome, refetch]);

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
        <ConfirmationHeader
          outcome={outcome}
          syncingHeading="Activating your package…"
          doneHeading="You're all set!"
        />

        {outcome === "pending" && <PendingNotice />}

        {settled(outcome) && (
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

  // A part payment, first or resumed — it granted nothing on its own, so the
  // page asks the server what is still owed rather than congratulating anybody:
  //   type=balance, session_id=cs_...
  if (type === "balance") {
    return <BalanceSuccess stripeSessionId={stripeSessionId} />;
  }

  // Merch success — Stripe success_url redirect (paid) or BuyButton (free item):
  //   type=merch [, session_id=cs_...]
  if (type === "merch") {
    return <MerchSuccess stripeSessionId={stripeSessionId} />;
  }

  // The Cross-Location Add-On bought on its own, against a plan already held:
  //   type=cross_location, session_id=cs_...
  if (type === "cross_location") {
    return <CrossLocationSuccess stripeSessionId={stripeSessionId} />;
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
