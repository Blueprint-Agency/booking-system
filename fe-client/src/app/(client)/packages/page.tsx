"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useAuthGate } from "@/components/auth/auth-gate";
import { BuyButton } from "@/components/checkout/buy-button";
import { cn } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { useApi } from "@/lib/api";
import {
  ApiClassPackage,
  ApiPtPackage,
  formatSgd,
  hasDiscount,
  usePackagesCatalog,
} from "@/lib/packages";

// ── Tab definitions ────────────────────────────────────────────────────────────

type MainTab = "classCredits" | "pt1on1" | "pt2on1";
type ClassSubTab = "bundle" | "unlimited" | "trial";

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const { data, loading, error, refresh } = usePackagesCatalog();
  const api = useApi();
  const [activeTab, setActiveTab] = useState<MainTab>("classCredits");
  const [classSubTab, setClassSubTab] = useState<ClassSubTab>("bundle");
  const [claimingTrialId, setClaimingTrialId] = useState<string | null>(null);
  const [trialMessage, setTrialMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  useEffect(() => {
    function fromHash(): { main: MainTab | null; sub: ClassSubTab | null } {
      const h =
        typeof window !== "undefined"
          ? window.location.hash.replace(/^#/, "").toLowerCase()
          : "";
      if (h === "trial" || h === "trial-pass")
        return { main: "classCredits", sub: "trial" };
      if (h === "unlimited") return { main: "classCredits", sub: "unlimited" };
      if (h === "bundle" || h === "bundles")
        return { main: "classCredits", sub: "bundle" };
      if (h === "pt1on1" || h === "private" || h === "1on1" || h === "1-on-1")
        return { main: "pt1on1", sub: null };
      if (h === "pt2on1" || h === "2on1" || h === "2-on-1")
        return { main: "pt2on1", sub: null };
      if (h === "classcredits" || h === "classes" || h === "credits")
        return { main: "classCredits", sub: null };
      return { main: null, sub: null };
    }
    const initial = fromHash();
    if (initial.main) setActiveTab(initial.main);
    if (initial.sub) setClassSubTab(initial.sub);
    const onHash = () => {
      const next = fromHash();
      if (next.main) setActiveTab(next.main);
      if (next.sub) setClassSubTab(next.sub);
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

  const ent = data?.entitlements ?? null;
  const hasUnlimited = ent?.has_active_unlimited ?? false;
  const hasBundle = ent?.has_active_bundle_credits ?? false;
  const trialUsed = ent?.trial_used ?? false;

  const MAIN_TABS: { key: MainTab; label: string; hidden?: boolean }[] = [
    { key: "classCredits", label: "Class Credits" },
    { key: "pt1on1", label: "PT 1-on-1" },
    { key: "pt2on1", label: "PT 2-on-1" },
  ];

  async function claimTrial(pkg: ApiClassPackage) {
    setClaimingTrialId(pkg.id);
    setTrialMessage(null);
    try {
      await api.post("/me/checkout/package", {
        package_kind: "class",
        package_id: pkg.id,
      });
      setTrialMessage({
        kind: "ok",
        text: "Trial pass claimed — head to Classes to book.",
      });
      await refresh();
    } catch (err) {
      const body =
        err && typeof err === "object" && "body" in err
          ? (err as { body: unknown }).body
          : null;
      const code =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : "";
      if (code === "trial_already_used") {
        setTrialMessage({
          kind: "err",
          text: "You've already used your trial pass.",
        });
      } else {
        setTrialMessage({
          kind: "err",
          text: "Couldn't claim trial pass. Please try again.",
        });
      }
    } finally {
      setClaimingTrialId(null);
    }
  }

  return (
    <>
      <div id="packages">
        <BookingSurface maxWidth="xl" padding="default">
          <SectionHeading
            eyebrow="Choose your track"
            title={trials.length > 0 ? "Class credits, trial or PT" : "Class credits or PT"}
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

              {/* ── Class Credits tab ───────────────────────────────── */}
              {activeTab === "classCredits" && (
                <ClassCreditsSection
                  bundles={bundles}
                  unlimited={unlimited}
                  trials={trials}
                  subTab={classSubTab}
                  setSubTab={setClassSubTab}
                  hasUnlimited={hasUnlimited}
                  hasBundle={hasBundle}
                  trialUsed={trialUsed}
                  claimingTrialId={claimingTrialId}
                  trialBanner={trialMessage}
                  onClaimTrial={claimTrial}
                />
              )}

              {/* ── PT 1-on-1 tab ───────────────────────────────────── */}
              {activeTab === "pt1on1" && <PtSection items={pt1on1} blurb={SHARED_BLURBS.pt1on1} />}

              {/* ── PT 2-on-1 tab ───────────────────────────────────── */}
              {activeTab === "pt2on1" && <PtSection items={pt2on1} blurb={SHARED_BLURBS.pt2on1} />}
            </>
          )}
        </BookingSurface>
      </div>
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
  claimingTrialId,
  trialBanner,
  onClaimTrial,
}: {
  bundles: ApiClassPackage[];
  unlimited: ApiClassPackage[];
  trials: ApiClassPackage[];
  subTab: ClassSubTab;
  setSubTab: (s: ClassSubTab) => void;
  hasUnlimited: boolean;
  hasBundle: boolean;
  trialUsed: boolean;
  claimingTrialId: string | null;
  trialBanner: { kind: "ok" | "err"; text: string } | null;
  onClaimTrial: (pkg: ApiClassPackage) => void | Promise<void>;
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
          claimingId={claimingTrialId}
          banner={trialBanner}
          onClaim={onClaimTrial}
        />
      )}
    </div>
  );
}

function TrialSection({
  trials,
  trialUsed,
  claimingId,
  banner,
  onClaim,
}: {
  trials: ApiClassPackage[];
  trialUsed: boolean;
  claimingId: string | null;
  banner: { kind: "ok" | "err"; text: string } | null;
  onClaim: (pkg: ApiClassPackage) => void | Promise<void>;
}) {
  if (trials.length === 0) {
    return <EmptyCatalog kind="trial" />;
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted text-center max-w-xl mx-auto">
        First time? Try us once — one credit, no commitment. Limited to one per
        student, ever.
      </p>
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
      {trialUsed && !banner && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center max-w-xl mx-auto">
          You've already used your trial pass. Browse our bundles or unlimited
          options to continue practising.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        {trials.map((p) => (
          <TrialCard
            key={p.id}
            pkg={p}
            disabled={trialUsed}
            isClaiming={claimingId === p.id}
            onClaim={() => onClaim(p)}
          />
        ))}
      </div>
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
    pkg.duration_days != null
      ? `${Math.round(pkg.duration_days / 30)} months`
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
  isClaiming,
  onClaim,
}: {
  pkg: ApiClassPackage;
  disabled: boolean;
  isClaiming: boolean;
  onClaim: () => void;
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
          title="Trial already used"
          className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium cursor-not-allowed"
        >
          Already used
        </span>
      ) : isFree ? (
        <>
          <button
            type="button"
            disabled={isClaiming}
            onClick={() => {
              if (!isSignedIn) {
                requireAuth("/packages#trial");
                return;
              }
              if (!isClaiming) onClaim();
            }}
            className={ctaClass}
          >
            {isClaiming && <Loader2 className="h-4 w-4 animate-spin" />}
            {isClaiming ? "Claiming…" : "Claim trial"}
          </button>
          {gate}
        </>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "class", packageId: pkg.id }}
          context="buy a package"
          gateHref="/packages#trial"
          className="rounded-full bg-accent text-white px-5 py-3 text-sm font-medium hover:bg-accent/90 mt-6 w-full text-center transition-colors"
        >
          Get trial
        </BuyButton>
      )}
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
        <p className="text-4xl font-extrabold text-ink">{pkg.num_sessions}</p>
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
        className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
      >
        Purchase
      </BuyButton>
    </div>
  );
}
