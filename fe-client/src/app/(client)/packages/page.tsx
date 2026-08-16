"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MessageCircle } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useAuthGate } from "@/components/auth/auth-gate";
import { BuyButton } from "@/components/checkout/buy-button";
import { cn, formatDurationMonths } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { useApi } from "@/lib/api";
import { useLocations } from "@/lib/classes";
import {
  ApiClassPackage,
  ApiPtPackage,
  formatSgd,
  hasDiscount,
  usePackagesCatalog,
} from "@/lib/packages";
import {
  ApiCorporatePackage,
  corporateContactWhatsappHref,
  submitCorporateRequest,
  useCorporatePackages,
} from "@/lib/corporate";

// ── Tab definitions ────────────────────────────────────────────────────────────

type MainTab = "group" | "private" | "corporate";
type ClassSubTab = "bundle" | "unlimited" | "trial";
type PrivateSubTab = "1on1" | "2on1";

// Indicative transport surcharge shown for corporate sessions at the member's own
// venue. Display only — nothing is charged in-app; the studio confirms it in the quote.
const CORPORATE_TRANSPORT_SURCHARGE_SGD = 50;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const { data, loading, error, refresh } = usePackagesCatalog();
  const { data: corporateData } = useCorporatePackages();
  const api = useApi();
  const [activeTab, setActiveTab] = useState<MainTab>("group");
  const [classSubTab, setClassSubTab] = useState<ClassSubTab>("bundle");
  const [privateSubTab, setPrivateSubTab] = useState<PrivateSubTab>("1on1");
  const [claimingTrialId, setClaimingTrialId] = useState<string | null>(null);
  const [pendingTrial, setPendingTrial] = useState<ApiClassPackage | null>(null);
  const [trialMessage, setTrialMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  useEffect(() => {
    function fromHash(): {
      main: MainTab | null;
      sub: ClassSubTab | null;
      priv: PrivateSubTab | null;
    } {
      const h =
        typeof window !== "undefined"
          ? window.location.hash.replace(/^#/, "").toLowerCase()
          : "";
      const none = { main: null, sub: null, priv: null };
      if (h === "trial" || h === "trial-pass")
        return { main: "group", sub: "trial", priv: null };
      if (h === "unlimited") return { main: "group", sub: "unlimited", priv: null };
      if (h === "bundle" || h === "bundles")
        return { main: "group", sub: "bundle", priv: null };
      if (h === "pt1on1" || h === "1on1" || h === "1-on-1")
        return { main: "private", sub: null, priv: "1on1" };
      if (h === "pt2on1" || h === "2on1" || h === "2-on-1")
        return { main: "private", sub: null, priv: "2on1" };
      if (h === "private" || h === "pt")
        return { main: "private", sub: null, priv: null };
      if (h === "corporate" || h === "corp")
        return { main: "corporate", sub: null, priv: null };
      if (
        h === "group" ||
        h === "classcredits" ||
        h === "classes" ||
        h === "credits"
      )
        return { main: "group", sub: null, priv: null };
      return none;
    }
    const initial = fromHash();
    if (initial.main) setActiveTab(initial.main);
    if (initial.sub) setClassSubTab(initial.sub);
    if (initial.priv) setPrivateSubTab(initial.priv);
    const onHash = () => {
      const next = fromHash();
      if (next.main) setActiveTab(next.main);
      if (next.sub) setClassSubTab(next.sub);
      if (next.priv) setPrivateSubTab(next.priv);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const bundles = useMemo(
    () => (data?.classPackages ?? []).filter((p) => p.kind === "credit_bundle"),
    [data],
  );
  const unlimited = useMemo(
    () => (data?.classPackages ?? []).filter((p) => p.kind === "unlimited"),
    [data],
  );
  const trials = useMemo(
    () => (data?.classPackages ?? []).filter((p) => p.kind === "trial"),
    [data],
  );
  const pt1on1 = useMemo(
    () => (data?.ptPackages ?? []).filter((p) => p.session_type === "1on1"),
    [data],
  );
  const pt2on1 = useMemo(
    () => (data?.ptPackages ?? []).filter((p) => p.session_type === "2on1"),
    [data],
  );

  const corporate = useMemo(
    () => (corporateData ?? []).filter((p) => p.status === "active"),
    [corporateData],
  );

  const ent = data?.entitlements ?? null;
  const hasUnlimited = ent?.has_active_unlimited ?? false;
  const hasBundle = ent?.has_active_bundle_credits ?? false;
  const trialUsed = ent?.trial_used ?? false;
  // Default eligible when signed-out (entitlements null) — auth gate runs on click.
  const trialEligible = ent?.trial_eligible ?? true;

  const MAIN_TABS: { key: MainTab; label: string; hidden?: boolean }[] = [
    { key: "group", label: "Group" },
    { key: "private", label: "Private" },
    { key: "corporate", label: "Corporate" },
  ];

  // Runs only AFTER the client confirms the Singapore-citizen disclaimer modal.
  // A $0 trial is granted immediately; a priced trial returns a Stripe Checkout
  // URL we redirect to.
  async function purchaseTrial(pkg: ApiClassPackage) {
    setPendingTrial(null);
    setClaimingTrialId(pkg.id);
    setTrialMessage(null);
    try {
      const res = await api.post<{
        outcome?: string;
        url?: string;
        client_package_id?: string;
      }>("/me/checkout/package", {
        package_kind: "class",
        package_id: pkg.id,
      });
      // Priced trial → off to Stripe Checkout.
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      // Free trial → granted immediately.
      setTrialMessage({
        kind: "ok",
        text: "Trial pass claimed — head to Classes to book.",
      });
      await refresh();
      setClaimingTrialId(null);
    } catch (err) {
      const body =
        err && typeof err === "object" && "body" in err
          ? (err as { body: unknown }).body
          : null;
      const code =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : "";
      const text =
        code === "trial_already_used"
          ? "You've already used your trial pass."
          : code === "trial_not_eligible"
            ? "The trial pass is for new members only — it looks like you already have a package."
            : "Couldn't start the trial purchase. Please try again.";
      setTrialMessage({ kind: "err", text });
      setClaimingTrialId(null);
    }
  }

  return (
    <>
      <div id="packages">
        <BookingSurface maxWidth="xl" padding="default">
          <SectionHeading
            eyebrow="Choose your track"
            title="Group, private or corporate"
          />

          {loading && (
            <div className="flex items-center justify-center py-16 text-muted text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading packages…
            </div>
          )}

          {!loading && error && (
            <div className="mx-auto max-w-md rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
              We couldn't load packages right now. Please refresh in a moment.
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* ── Main tab strip ──────────────────────────────────── */}
              <div className="flex justify-center mb-6">
                <div
                  role="tablist"
                  aria-label="Package family"
                  className="inline-flex items-center gap-1 p-1 rounded-full bg-warm border border-ink/10"
                >
                  {MAIN_TABS.filter((t) => !t.hidden).map((tab) => {
                    const isActive = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "relative rounded-full px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-200",
                          isActive
                            ? "bg-ink text-paper shadow-sm"
                            : "text-muted hover:text-ink",
                        )}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Group tab ───────────────────────────────────────── */}
              {activeTab === "group" && (
                <ClassCreditsSection
                  bundles={bundles}
                  unlimited={unlimited}
                  trials={trials}
                  subTab={classSubTab}
                  setSubTab={setClassSubTab}
                  hasUnlimited={hasUnlimited}
                  hasBundle={hasBundle}
                  trialUsed={trialUsed}
                  trialEligible={trialEligible}
                  claimingTrialId={claimingTrialId}
                  trialBanner={trialMessage}
                  onRequestTrial={setPendingTrial}
                />
              )}

              {/* ── Private (PT) tab ────────────────────────────────── */}
              {activeTab === "private" && (
                <PrivateSection
                  pt1on1={pt1on1}
                  pt2on1={pt2on1}
                  subTab={privateSubTab}
                  setSubTab={setPrivateSubTab}
                />
              )}

              {/* ── Corporate tab ───────────────────────────────────── */}
              {activeTab === "corporate" && <CorporateSection items={corporate} />}
            </>
          )}
        </BookingSurface>
      </div>

      {pendingTrial && (
        <TrialDisclaimerModal
          pkg={pendingTrial}
          onCancel={() => setPendingTrial(null)}
          onConfirm={() => purchaseTrial(pendingTrial)}
        />
      )}
    </>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

const SHARED_BLURBS = {
  pt1on1:
    "Fully dedicated time with one of our instructors, tailored entirely to your goals. Private packages are measured in sessions (not credits) — 1 session = 30 mins.",
  pt2on1:
    "Train with a partner. Shared cost, shared motivation, same dedicated instructor. Split the price between two people.",
};

function ClassCreditsSection({
  bundles,
  unlimited,
  trials,
  subTab,
  setSubTab,
  hasUnlimited,
  hasBundle,
  trialUsed,
  trialEligible,
  claimingTrialId,
  trialBanner,
  onRequestTrial,
}: {
  bundles: ApiClassPackage[];
  unlimited: ApiClassPackage[];
  trials: ApiClassPackage[];
  subTab: ClassSubTab;
  setSubTab: (s: ClassSubTab) => void;
  hasUnlimited: boolean;
  hasBundle: boolean;
  trialUsed: boolean;
  trialEligible: boolean;
  claimingTrialId: string | null;
  trialBanner: { kind: "ok" | "err"; text: string } | null;
  onRequestTrial: (pkg: ApiClassPackage) => void;
}) {
  const subTabs: { key: ClassSubTab; label: string; hidden?: boolean }[] = [
    { key: "bundle", label: "Credit Bundles" },
    { key: "unlimited", label: "Unlimited Access" },
    { key: "trial", label: "Trial Pass", hidden: trials.length === 0 },
  ];

  return (
    <div className="space-y-8">
      <div role="tablist" aria-label="Class credit type" className="flex justify-center gap-8">
        {subTabs
          .filter((t) => !t.hidden)
          .map((tab) => {
            const isActive = subTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setSubTab(tab.key)}
                className={cn(
                  "relative pb-3 text-sm font-medium transition-colors",
                  isActive ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "absolute left-0 right-0 -bottom-px h-0.5 rounded-full transition-all",
                    isActive ? "bg-ink" : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
      </div>

      {subTab === "bundle" && (
        <>
          {hasUnlimited && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
              You have an active Unlimited pass. Credit Bundles can't be purchased while Unlimited is active.
            </div>
          )}
          {bundles.length === 0 ? (
            <EmptyCatalog kind="bundle" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {bundles.map((p) => (
                <BundleCard
                  key={p.id}
                  pkg={p}
                  disabled={hasUnlimited}
                  disabledReason={hasUnlimited ? "Unlimited pass already active" : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}

      {subTab === "unlimited" && (
        <>
          {hasBundle && !hasUnlimited && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
              You still have an active Credit Bundle. Unlimited can't be purchased while a bundle has credits remaining.
            </div>
          )}
          {hasUnlimited && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
              You already have an active Unlimited pass. You can purchase a new one after it expires.
            </div>
          )}
          {unlimited.length === 0 ? (
            <EmptyCatalog kind="unlimited" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {unlimited.map((p) => (
                <UnlimitedCard
                  key={p.id}
                  pkg={p}
                  disabled={hasBundle || hasUnlimited}
                  disabledReason={
                    hasUnlimited ? "Unlimited pass already active" : "Credit Bundle still active"
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {subTab === "trial" && (
        <TrialSection
          trials={trials}
          trialUsed={trialUsed}
          trialEligible={trialEligible}
          claimingId={claimingTrialId}
          banner={trialBanner}
          onRequestTrial={onRequestTrial}
        />
      )}
    </div>
  );
}

function TrialSection({
  trials,
  trialUsed,
  trialEligible,
  claimingId,
  banner,
  onRequestTrial,
}: {
  trials: ApiClassPackage[];
  trialUsed: boolean;
  trialEligible: boolean;
  claimingId: string | null;
  banner: { kind: "ok" | "err"; text: string } | null;
  onRequestTrial: (pkg: ApiClassPackage) => void;
}) {
  if (trials.length === 0) {
    return <EmptyCatalog kind="trial" />;
  }
  // Greyed out unless the client owns nothing yet. Distinguish "already used"
  // from "not a new member" so the reason is clear.
  const disabledReason = !trialEligible
    ? trialUsed
      ? "Trial already used"
      : "New members only"
    : undefined;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted text-center max-w-xl mx-auto">
        First time? Try us once — no commitment. Limited to one per student, ever.
      </p>

      {/* Eligibility disclaimer — shown before purchase, always visible. */}
      <div className="rounded-xl border border-accent/30 bg-accent/5 text-ink text-xs sm:text-sm px-4 py-3 max-w-xl mx-auto">
        <p className="font-medium">🇸🇬 Singapore citizens only</p>
        <p className="text-muted mt-1 leading-relaxed">
          The trial pass is available to Singapore citizens only. We verify
          citizenship by checking your ID at the studio. If you purchase a trial
          pass but cannot verify Singapore citizenship, it is{" "}
          <span className="font-medium text-ink">non-refundable</span>.
        </p>
      </div>

      {banner && (
        <div
          className={cn(
            "rounded-xl border text-ink text-sm px-4 py-3 text-center max-w-xl mx-auto",
            banner.kind === "ok"
              ? "border-sage/40 bg-sage/10"
              : "border-warning/30 bg-warning/10",
          )}
        >
          {banner.text}
        </div>
      )}
      {!trialEligible && !banner && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center max-w-xl mx-auto">
          {trialUsed
            ? "You've already used your trial pass. Browse our bundles or unlimited options to continue practising."
            : "The trial pass is for new members only. Since you already have a package, browse our bundles or unlimited options."}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        {trials.map((p) => (
          <TrialCard
            key={p.id}
            pkg={p}
            disabled={!trialEligible}
            disabledReason={disabledReason}
            isClaiming={claimingId === p.id}
            onRequestPurchase={() => onRequestTrial(p)}
          />
        ))}
      </div>
    </div>
  );
}

function PrivateSection({
  pt1on1,
  pt2on1,
  subTab,
  setSubTab,
}: {
  pt1on1: ApiPtPackage[];
  pt2on1: ApiPtPackage[];
  subTab: PrivateSubTab;
  setSubTab: (s: PrivateSubTab) => void;
}) {
  const subTabs: { key: PrivateSubTab; label: string }[] = [
    { key: "1on1", label: "1-on-1" },
    { key: "2on1", label: "2-on-1" },
  ];

  return (
    <div className="space-y-8">
      <div role="tablist" aria-label="Private session type" className="flex justify-center gap-8">
        {subTabs.map((tab) => {
          const isActive = subTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setSubTab(tab.key)}
              className={cn(
                "relative pb-3 text-sm font-medium transition-colors",
                isActive ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "absolute left-0 right-0 -bottom-px h-0.5 rounded-full transition-all",
                  isActive ? "bg-ink" : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>

      {subTab === "1on1" && <PtSection items={pt1on1} blurb={SHARED_BLURBS.pt1on1} />}
      {subTab === "2on1" && <PtSection items={pt2on1} blurb={SHARED_BLURBS.pt2on1} />}
    </div>
  );
}

function PtSection({ items, blurb }: { items: ApiPtPackage[]; blurb: string }) {
  if (items.length === 0) {
    return <EmptyCatalog kind="pt" />;
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted text-center max-w-xl mx-auto">{blurb}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        {items.map((p) => (
          <PtCard key={p.id} pkg={p} />
        ))}
      </div>
    </div>
  );
}

function EmptyCatalog({ kind }: { kind: "bundle" | "unlimited" | "trial" | "pt" }) {
  const copy = {
    bundle: "No credit bundles are available right now.",
    unlimited: "No unlimited passes are available right now.",
    trial: "No trial pass is currently offered.",
    pt: "No PT packages are available right now.",
  } as const;
  return (
    <div className="mx-auto max-w-md text-center py-8 text-muted text-sm">
      {copy[kind]}
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function PromoTag({ pkg }: { pkg: ApiClassPackage | ApiPtPackage }) {
  if (!hasDiscount(pkg)) return null;
  return (
    <span className="absolute -top-2.5 right-4 text-[10px] font-mono uppercase tracking-wider bg-accent/15 text-accent-deep border border-accent/30 px-2.5 py-0.5 rounded-full">
      Promo
    </span>
  );
}

function PriceBlock({ pkg }: { pkg: ApiClassPackage | ApiPtPackage }) {
  const discounted = hasDiscount(pkg);
  return (
    <div className="flex items-baseline gap-2 mt-4">
      <p className="text-2xl font-bold">{formatSgd(pkg.effective_price_sgd)}</p>
      {discounted && (
        <span className="text-sm text-muted line-through">{formatSgd(pkg.price_sgd)}</span>
      )}
    </div>
  );
}

function BundleCard({
  pkg,
  disabled,
  disabledReason,
}: {
  pkg: ApiClassPackage;
  disabled: boolean;
  disabledReason?: string;
}) {
  const credits = pkg.credits ?? 0;
  const validity =
    pkg.validity_days != null ? `${pkg.validity_days} days` : "no expiry";
  return (
    <div className="relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all">
      <PromoTag pkg={pkg} />
      <div>
        <p className="text-4xl font-extrabold text-ink">
          {credits} {credits === 1 ? "credit" : "credits"}
        </p>
        <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
        <p className="text-sm text-muted mt-1">Valid for {validity}</p>
      </div>
      <PriceBlock pkg={pkg} />
      <div className="mt-6 flex-1" />
      {disabled ? (
        <span
          title={disabledReason}
          className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium cursor-not-allowed"
        >
          Unavailable
        </span>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "class", packageId: pkg.id }}
          context="buy a package"
          gateHref="/packages"
          priceSgd={pkg.effective_price_sgd}
          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
        >
          Purchase
        </BuyButton>
      )}
    </div>
  );
}

function UnlimitedCard({
  pkg,
  disabled,
  disabledReason,
}: {
  pkg: ApiClassPackage;
  disabled: boolean;
  disabledReason?: string;
}) {
  const months =
    pkg.duration_months != null
      ? formatDurationMonths(pkg.duration_months)
      : "unlimited";
  return (
    <div className="relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all">
      <PromoTag pkg={pkg} />
      <div>
        <p className="text-4xl font-extrabold text-ink">{months}</p>
        <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
      </div>
      <PriceBlock pkg={pkg} />
      <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
        <li>Unlimited classes for {months}</li>
        <li>All group classes included</li>
        <li>No class limit per week</li>
        <li>Valid across both locations</li>
      </ul>
      {disabled ? (
        <span
          title={disabledReason}
          className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium cursor-not-allowed"
        >
          Unavailable
        </span>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "class", packageId: pkg.id }}
          context="buy a package"
          gateHref="/packages"
          priceSgd={pkg.effective_price_sgd}
          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
        >
          Purchase
        </BuyButton>
      )}
    </div>
  );
}

function TrialCard({
  pkg,
  disabled,
  disabledReason,
  isClaiming,
  onRequestPurchase,
}: {
  pkg: ApiClassPackage;
  disabled: boolean;
  disabledReason?: string;
  isClaiming: boolean;
  onRequestPurchase: () => void;
}) {
  const { isSignedIn } = useUser();
  const { requireAuth, gate } = useAuthGate("buy a package");
  const credits = pkg.credits ?? 1;
  const isFree = Number(pkg.effective_price_sgd) === 0;
  const validity =
    pkg.validity_days != null ? `${pkg.validity_days} days` : "redeem anytime";

  const ctaClass = cn(
    "rounded-full bg-accent text-white px-5 py-3 text-sm font-medium hover:bg-accent/90 mt-6 w-full text-center transition-colors inline-flex items-center justify-center gap-2",
    isClaiming && "opacity-70 cursor-wait",
  );

  return (
    <div className="relative rounded-2xl bg-paper border border-accent/40 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all">
      <span className="absolute -top-2.5 left-4 text-[10px] font-mono uppercase tracking-wider bg-accent text-white px-2.5 py-0.5 rounded-full">
        Trial
      </span>
      <div>
        <p className="text-4xl font-extrabold text-ink">
          {credits} {credits === 1 ? "credit" : "credits"}
        </p>
        <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
      </div>
      <PriceBlock pkg={pkg} />
      <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
        <li>One-time only per student</li>
        <li>Valid for {validity}</li>
        <li>Any group class, any location</li>
      </ul>
      {disabled ? (
        <span
          title={disabledReason}
          className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium cursor-not-allowed"
        >
          {disabledReason ?? "Unavailable"}
        </span>
      ) : (
        <>
          <button
            type="button"
            disabled={isClaiming}
            onClick={() => {
              if (!isSignedIn) {
                requireAuth("/packages#trial");
                return;
              }
              if (!isClaiming) onRequestPurchase();
            }}
            className={ctaClass}
          >
            {isClaiming && <Loader2 className="h-4 w-4 animate-spin" />}
            {isClaiming ? "Processing…" : isFree ? "Claim trial" : "Get trial pass"}
          </button>
          {gate}
        </>
      )}
    </div>
  );
}

// Singapore-citizen eligibility gate shown AFTER the client clicks purchase and
// BEFORE we hit checkout. Requires an explicit acknowledgement.
function TrialDisclaimerModal({
  pkg,
  onCancel,
  onConfirm,
}: {
  pkg: ApiClassPackage;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [ack, setAck] = useState(false);
  const isFree = Number(pkg.effective_price_sgd) === 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-paper rounded-2xl p-8 max-w-md w-full shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-serif text-xl text-ink leading-snug">
          Trial pass — Singapore citizens only
        </h3>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Before you continue, please confirm you understand:
        </p>
        <ul className="text-sm text-muted mt-3 space-y-2 leading-relaxed list-disc pl-5">
          <li>The trial pass is available to Singapore citizens only.</li>
          <li>
            We verify Singapore citizenship by checking your ID at the studio on
            your first visit.
          </li>
          <li>
            If you purchase a trial pass but cannot verify Singapore
            citizenship, it is{" "}
            <span className="font-medium text-ink">non-refundable</span>.
          </li>
        </ul>

        <label className="flex items-start gap-2.5 mt-5 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
          />
          <span>
            I am a Singapore citizen and I understand the trial pass is
            non-refundable if my citizenship cannot be verified.
          </span>
        </label>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={!ack}
            onClick={onConfirm}
            className={cn(
              "w-full rounded-full bg-accent text-white py-3 text-sm font-semibold transition-colors",
              ack ? "hover:bg-accent/90" : "opacity-50 cursor-not-allowed",
            )}
          >
            {isFree ? "Claim trial pass" : "Continue to payment"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function PtCard({ pkg }: { pkg: ApiPtPackage }) {
  const perSession = Math.round(Number(pkg.effective_price_sgd) / pkg.num_sessions);
  const partnerLine =
    pkg.session_type === "2on1"
      ? "Train with one partner"
      : `${pkg.num_sessions} personal training sessions`;
  return (
    <div className="relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all">
      <PromoTag pkg={pkg} />
      <div>
        <p className="text-4xl font-extrabold text-ink">
          {pkg.num_sessions} {pkg.num_sessions === 1 ? "session" : "sessions"}
        </p>
        <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
      </div>
      <PriceBlock pkg={pkg} />
      <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
        <li>{partnerLine}</li>
        <li>{formatSgd(perSession)}/session</li>
        <li>Dedicated instructor throughout</li>
        <li>Valid across both locations</li>
      </ul>
      <BuyButton
        target={{ kind: "package", packageKind: "pt", packageId: pkg.id }}
        context="buy a package"
        gateHref="/packages"
        priceSgd={pkg.effective_price_sgd}
        className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
      >
        Purchase
      </BuyButton>
    </div>
  );
}

// ── Corporate ─────────────────────────────────────────────────────────────────

function CorporateSection({ items }: { items: ApiCorporatePackage[] }) {
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted text-center max-w-xl mx-auto">
        Bring mindful movement to your workplace. Request a package below — we
        arrange the dates, location and instructor with you over WhatsApp.
      </p>

      {items.length === 0 ? (
        <div className="mx-auto max-w-md text-center py-8 text-muted text-sm">
          No corporate packages are available right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {items.map((p) => (
            <CorporateCard key={p.id} pkg={p} />
          ))}
        </div>
      )}

      <div className="mt-10 flex flex-col items-center gap-2 text-center">
        <a
          href={corporateContactWhatsappHref()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-ink/15 px-5 py-3 text-sm font-medium text-ink hover:bg-warm transition-colors"
        >
          <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
          Contact us on WhatsApp
        </a>
        <p className="text-xs text-muted">
          Questions first? Chat with us before you buy.
        </p>
      </div>
    </div>
  );
}

function CorporateCard({ pkg }: { pkg: ApiCorporatePackage }) {
  const { isSignedIn } = useUser();
  const { requireAuth, gate } = useAuthGate("buy a package");
  const api = useApi();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  // Submitting the request form sends a corporate request directly — no payment.
  // The studio arranges the rest over WhatsApp; the new request appears under the
  // member's account, so we route there on success.
  async function startRequest(details: {
    location: string;
    notes: string;
    customLocation: boolean;
  }) {
    setPending(true);
    setErr(false);
    try {
      await submitCorporateRequest(api, pkg.id, {
        location: details.location || undefined,
        notes: details.notes || undefined,
      });
      router.push("/account/corporate");
    } catch {
      setErr(true);
      setPending(false);
    }
  }

  return (
    <div className="relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all">
      <div>
        <p className="text-base font-medium text-ink">{pkg.name}</p>
        {pkg.description && (
          <p className="text-sm text-muted mt-2 leading-relaxed">
            {pkg.description}
          </p>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-4">
        <p className="text-2xl font-bold">{formatSgd(pkg.price_sgd)}</p>
      </div>
      <div className="mt-6 flex-1" />
      {err && (
        <p className="text-xs text-error mb-2">
          Couldn&apos;t send your request. Please try again.
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!isSignedIn) {
            requireAuth("/packages#corporate");
            return;
          }
          if (!pending) {
            setErr(false);
            setFormOpen(true);
          }
        }}
        className={cn(
          "rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 w-full text-center transition-colors inline-flex items-center justify-center gap-2",
          pending && "opacity-70 cursor-wait",
        )}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Sending…" : "Request this package"}
      </button>
      {gate}

      {formOpen && (
        <CorporateRequestModal
          pkg={pkg}
          pending={pending}
          submitError={err}
          onCancel={() => {
            setErr(false);
            setFormOpen(false);
          }}
          onSubmit={startRequest}
        />
      )}
    </div>
  );
}

// Collected before checkout so we can tell the studio where the member wants
// the corporate sessions held and capture any notes. The choices are the studio
// locations plus a free-text "our own venue" option.
function CorporateRequestModal({
  pkg,
  pending,
  submitError,
  onCancel,
  onSubmit,
}: {
  pkg: ApiCorporatePackage;
  pending: boolean;
  submitError: boolean;
  onCancel: () => void;
  onSubmit: (details: {
    location: string;
    notes: string;
    customLocation: boolean;
  }) => void;
}) {
  const { data: locations } = useLocations();
  const studioOptions = (locations ?? []).map((l) => l.name);
  const CUSTOM = "__custom__";
  const [where, setWhere] = useState("");
  const [customWhere, setCustomWhere] = useState("");
  const [notes, setNotes] = useState("");
  const [mounted, setMounted] = useState(false);

  const isCustom = where === CUSTOM;
  const resolvedWhere = isCustom ? customWhere.trim() : where.trim();
  const canSubmit = resolvedWhere.length > 0 && !pending;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, pending]);

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({ location: resolvedWhere, notes: notes.trim(), customLocation: isCustom });
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={pending ? undefined : onCancel}
    >
      <div
        className="bg-paper rounded-2xl p-8 max-w-md w-full shadow-modal max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-serif text-xl text-ink leading-snug">
          Request {pkg.name}
        </h3>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Tell us where you&apos;d like the sessions held and anything we should
          know. We&apos;ll reach out to you to further confirm the corporate
          package arrangements.
        </p>

        {/* Where */}
        <div className="mt-5">
          <label className="block text-sm font-medium text-ink">
            Where would you like the sessions?
          </label>
          <div className="mt-2 space-y-2">
            {studioOptions.map((name) => (
              <label
                key={name}
                className="flex items-center gap-2.5 text-sm text-ink cursor-pointer"
              >
                <input
                  type="radio"
                  name="corporate-where"
                  value={name}
                  checked={where === name}
                  onChange={(e) => setWhere(e.target.value)}
                  className="h-4 w-4 border-ink/30 text-accent focus:ring-accent"
                />
                <span>{name}</span>
              </label>
            ))}
            <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
              <input
                type="radio"
                name="corporate-where"
                value={CUSTOM}
                checked={where === CUSTOM}
                onChange={(e) => setWhere(e.target.value)}
                className="h-4 w-4 border-ink/30 text-accent focus:ring-accent"
              />
              <span>Another location (our office / venue)</span>
            </label>
          </div>
          {isCustom && (
            <>
              <input
                type="text"
                value={customWhere}
                onChange={(e) => setCustomWhere(e.target.value)}
                placeholder="Address or venue name"
                className="mt-2 w-full rounded-xl border border-ink/15 bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="mt-2 text-xs text-muted">
                Sessions at your own venue typically add a{" "}
                <span className="font-medium text-ink">
                  {formatSgd(CORPORATE_TRANSPORT_SURCHARGE_SGD)} transport surcharge
                </span>{" "}
                for instructor travel — we&apos;ll confirm it in your quote.
              </p>
            </>
          )}
        </div>

        {/* Notes */}
        <div className="mt-5">
          <label className="block text-sm font-medium text-ink">
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Group size, preferred dates/times, focus, or anything else."
            className="mt-2 w-full rounded-xl border border-ink/15 bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />
        </div>

        {/* Indicative price — nothing is charged here; the studio confirms the
            final quote when arranging the sessions. */}
        <dl className="mt-6 space-y-1.5 border-t border-ink/10 pt-4 text-sm">
          <div className="flex items-center justify-between font-medium text-ink">
            <dt>{pkg.name}</dt>
            <dd>{formatSgd(pkg.price_sgd)}</dd>
          </div>
          <p className="text-xs text-muted">
            No payment now — we&apos;ll confirm the final quote
            {isCustom ? " (incl. transport)" : ""} when we reach out.
          </p>
        </dl>

        {submitError && (
          <p className="mt-4 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
            Couldn&apos;t send your request. Please try again.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className={cn(
              "w-full rounded-full bg-ink text-paper py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2",
              canSubmit ? "hover:bg-ink/90" : "opacity-50 cursor-not-allowed",
            )}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? "Sending…" : "Send request"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
