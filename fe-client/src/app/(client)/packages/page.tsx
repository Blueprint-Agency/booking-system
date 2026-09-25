"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { useMemberSession } from "@/lib/member-auth";
import { useRouter } from "next/navigation";
import { useAuthGate } from "@/components/auth/auth-gate";
import { BuyButton } from "@/components/checkout/buy-button";
import { blockedByPayments, NO_ONLINE_PAYMENTS, useOnlinePayments } from "@/lib/online-payments";
import { cn, formatDurationMonths } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { FilterChips } from "@/components/ui/filter-chips";
import { ContentLoading } from "@/components/ui/content-loading";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  NOTE,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { useApi } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
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
  WHATSAPP_COPY_KEY,
} from "@/lib/corporate";
import { useBrandCopy } from "@/components/brand/brand-provider";

// ── Tab definitions ────────────────────────────────────────────────────────────

type MainTab = "group" | "private" | "corporate";
type ClassSubTab = "bundle" | "unlimited" | "trial";
type PrivateSubTab = "1on1" | "2on1";

// Indicative transport surcharge shown for corporate sessions at the member's own
// venue. Display only — nothing is charged in-app; the studio confirms it in the quote.
const CORPORATE_TRANSPORT_SURCHARGE_SGD = 50;

/**
 * The studio's own terms for its trial pass — who may buy it and what happens
 * if they turn out not to qualify — from `tenant_settings.copy`. Studio policy,
 * so it is the studio's words or none: with no terms set, the trial is sold
 * without a notice or an acknowledgement step. Plain text; blank lines survive.
 */
const TRIAL_TERMS_COPY_KEY = "trial.terms";
/** The line a member ticks to accept those terms; a neutral one when unset. */
const TRIAL_ACK_COPY_KEY = "trial.acknowledgement";

const PACKAGE_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4";

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
  const trialTerms = useBrandCopy(TRIAL_TERMS_COPY_KEY, "");
  const trialAck = useBrandCopy(TRIAL_ACK_COPY_KEY, "I have read and accept these terms.");
  // Terms to accept → the acknowledgement step first; none → straight on.
  const requestTrial = (pkg: ApiClassPackage) =>
    trialTerms ? setPendingTrial(pkg) : purchaseTrial(pkg);

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

  // Runs after the member accepts the studio's trial terms, when it has any.
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
        text: "Trial pass added. Book a class from the schedule.",
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
        code === ERROR_CODES.trial_already_used
          ? "You've already used your trial pass."
          : code === ERROR_CODES.trial_not_eligible
            ? "The trial pass is for new members only."
            : code === ERROR_CODES.payments_not_configured
              ? NO_ONLINE_PAYMENTS
              : "Couldn't get the trial pass. Try again.";
      setTrialMessage({ kind: "err", text });
      setClaimingTrialId(null);
    }
  }

  return (
    <>
      <BookingSurface>
          <PageHeader title="Packages" />

          {loading && (
            <ContentLoading label="Loading packages" />
          )}

          {!loading && error && (
            <div className={cn(CARD, "p-8 text-center text-sm text-muted")}>
              Couldn&apos;t load packages. Refresh to try again.
            </div>
          )}

          {!loading && !error && data && (
            <>
              <SegmentedTabs
                label="Package family"
                tabs={MAIN_TABS.filter((t) => !t.hidden).map((t) => ({ value: t.key, label: t.label }))}
                value={activeTab}
                onChange={setActiveTab}
              />

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
                  onRequestTrial={requestTrial}
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

      {pendingTrial && (
        <TrialTermsModal
          pkg={pendingTrial}
          terms={trialTerms}
          acknowledgement={trialAck}
          onCancel={() => setPendingTrial(null)}
          onConfirm={() => purchaseTrial(pendingTrial)}
        />
      )}
    </>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

const SHARED_BLURBS = {
  pt1on1: "One-to-one time with an instructor. 1 session = 30 min.",
  pt2on1: "Train with a partner and share the cost. 1 session = 30 min.",
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
    { key: "bundle", label: "Credit bundles" },
    { key: "unlimited", label: "Unlimited" },
    { key: "trial", label: "Trial pass", hidden: trials.length === 0 },
  ];

  return (
    <div className="space-y-4">
      <FilterChips
        label="Class package type"
        options={subTabs.filter((t) => !t.hidden).map((t) => ({ value: t.key, label: t.label }))}
        value={subTab}
        onChange={setSubTab}
      />

      {/* Nothing blocks a purchase on top of what the member holds: every
          package waits Dormant and starts on the first booking after the one in
          front has ended (§3). Only one class package runs at a time, and a
          member with one running is told the new one will wait, not refused. */}
      {subTab === "bundle" && (
        <>
          {(hasUnlimited || hasBundle) && (
            <p className={NOTE}>
              You already have a {hasUnlimited ? "class pass" : "credit bundle"}. A new bundle
              starts on your first booking after it ends or runs out.
            </p>
          )}
          {bundles.length === 0 ? (
            <EmptyCatalog kind="bundle" />
          ) : (
            <div className={PACKAGE_GRID}>
              {bundles.map((p) => (
                <BundleCard key={p.id} pkg={p} disabled={false} disabledReason="" />
              ))}
            </div>
          )}
        </>
      )}

      {subTab === "unlimited" && (
        <>
          {hasBundle && !hasUnlimited && (
            <p className={NOTE}>
              You still have class credits. A new pass starts on your first booking after
              they run out or expire.
            </p>
          )}
          {hasUnlimited && (
            <p className={NOTE}>
              You already have an Unlimited pass. A new one starts on your first booking after
              it ends, at the same home studio.
            </p>
          )}
          {unlimited.length === 0 ? (
            <EmptyCatalog kind="unlimited" />
          ) : (
            <div className={PACKAGE_GRID}>
              {unlimited.map((p) => (
                <UnlimitedCard key={p.id} pkg={p} disabled={false} disabledReason="" />
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
  const terms = useBrandCopy(TRIAL_TERMS_COPY_KEY, "");
  if (trials.length === 0) {
    return <EmptyCatalog kind="trial" />;
  }
  // Greyed out unless the client owns nothing yet. Distinguish "already used"
  // from "not a new member" so the reason is clear.
  const disabledReason = trialUsed
    ? "Trial already used"
    : "New members only";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">For first-timers. One per member.</p>

      {/* The studio's own trial terms, shown before purchase — or nothing. */}
      {terms && (
        <div className={NOTE}>
          <p className="font-semibold">Terms</p>
          <p className="mt-1 text-muted leading-relaxed whitespace-pre-line">{terms}</p>
        </div>
      )}

      {banner && (
        <div
          role="status"
          className={cn(
            "rounded-xl border px-4 py-3 text-sm text-ink",
            banner.kind === "ok"
              ? "border-sage/25 bg-sage/10"
              : "border-error/25 bg-error/10",
          )}
        >
          {banner.text}
        </div>
      )}
      {!trialEligible && !banner && (
        <p className={NOTE}>
          {trialUsed
            ? "You've used your trial pass. See credit bundles or Unlimited to keep booking."
            : "The trial pass is for new members only. See credit bundles or Unlimited instead."}
        </p>
      )}
      <div className={PACKAGE_GRID}>
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
    <div className="space-y-4">
      <FilterChips
        label="Private session type"
        options={subTabs.map((t) => ({ value: t.key, label: t.label }))}
        value={subTab}
        onChange={setSubTab}
      />

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
      <p className="text-sm text-muted">{blurb}</p>
      <div className={PACKAGE_GRID}>
        {items.map((p) => (
          <PtCard key={p.id} pkg={p} />
        ))}
      </div>
    </div>
  );
}

function EmptyCatalog({ kind }: { kind: "bundle" | "unlimited" | "trial" | "pt" }) {
  const copy = {
    bundle: "No credit bundles on sale right now.",
    unlimited: "No Unlimited passes on sale right now.",
    trial: "No trial pass on offer right now.",
    pt: "No private session packages on sale right now.",
  } as const;
  return <div className={cn(CARD, "px-6 py-10 text-center text-sm text-muted")}>{copy[kind]}</div>;
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/**
 * Every package card: what it is, the one number that sizes it, the price,
 * what's included, and the action at the foot — lined up across a row.
 * Drawn like the account's balance tiles, so a package reads the same before
 * and after it's bought.
 */
function PackageCard({
  name,
  headline,
  sub,
  badge,
  price,
  features,
  highlight = false,
  children,
}: {
  name: string;
  headline: string;
  sub?: string;
  badge?: string | null;
  price: React.ReactNode;
  features?: string[];
  highlight?: boolean;
  /** The action. */
  children: React.ReactNode;
}) {
  return (
    <div className={cn(CARD, "flex flex-col p-5 sm:p-6", highlight && "border-accent/30")}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold leading-5 text-muted">{name}</p>
        {badge && (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent/10 px-2 text-[11px] font-bold text-accent-deep">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink leading-none">{headline}</p>
      {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
      <div className="mt-4">{price}</div>
      {features && features.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-ink/5 pt-4 text-sm text-ink/80">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-5">{children}</div>
    </div>
  );
}

const promo = (pkg: ApiClassPackage | ApiPtPackage) => (hasDiscount(pkg) ? "Promo" : null);

const CARD_BUTTON = cn(BTN_PRIMARY, "w-full");

function DisabledButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" disabled className={cn(BTN_PRIMARY, "w-full bg-ink/10 text-muted hover:bg-ink/10")}>
      {children}
    </button>
  );
}

function PriceBlock({ pkg }: { pkg: ApiClassPackage | ApiPtPackage }) {
  const discounted = hasDiscount(pkg);
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-xl font-bold text-ink">{formatSgd(pkg.effective_price_sgd)}</span>
      {discounted && (
        <span className="text-sm text-muted line-through">{formatSgd(pkg.price_sgd)}</span>
      )}
    </p>
  );
}

function BundleCard({
  pkg,
  disabled,
  disabledReason,
}: {
  pkg: ApiClassPackage;
  disabled: boolean;
  disabledReason: string;
}) {
  const credits = pkg.credits ?? 0;
  // The days count from the member's first class, not from purchase (§3).
  const validity =
    pkg.validity_days != null ? `Valid ${pkg.validity_days} days from your first class` : "No expiry";
  return (
    <PackageCard
      name={pkg.name}
      headline={`${credits} ${credits === 1 ? "credit" : "credits"}`}
      sub={validity}
      badge={promo(pkg)}
      price={<PriceBlock pkg={pkg} />}
    >
      {disabled ? (
        <DisabledButton>{disabledReason}</DisabledButton>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "class", packageId: pkg.id }}
          context="buy a package"
          gateHref="/packages"
          priceSgd={pkg.effective_price_sgd}
          className={CARD_BUTTON}
        >
          Purchase
        </BuyButton>
      )}
    </PackageCard>
  );
}

function UnlimitedCard({
  pkg,
  disabled,
  disabledReason,
}: {
  pkg: ApiClassPackage;
  disabled: boolean;
  disabledReason: string;
}) {
  const months =
    pkg.duration_months != null
      ? formatDurationMonths(pkg.duration_months)
      : "Unlimited";
  return (
    <PackageCard
      name={pkg.name}
      headline={months}
      sub="Unlimited group classes"
      badge={promo(pkg)}
      price={<PriceBlock pkg={pkg} />}
      features={["No weekly class limit", "One home studio, chosen at checkout"]}
    >
      {disabled ? (
        <DisabledButton>{disabledReason}</DisabledButton>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "class", packageId: pkg.id }}
          context="buy a package"
          gateHref="/packages"
          priceSgd={pkg.effective_price_sgd}
          // A plan has a Home studio to pick, at every price — including one a
          // Promotion took to zero.
          requiresReview
          className={CARD_BUTTON}
        >
          Purchase
        </BuyButton>
      )}
    </PackageCard>
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
  disabledReason: string;
  isClaiming: boolean;
  onRequestPurchase: () => void;
}) {
  const { isSignedIn } = useMemberSession();
  const { requireAuth, gate } = useAuthGate("buy a package");
  const credits = pkg.credits ?? 1;
  const isFree = Number(pkg.effective_price_sgd) === 0;
  const onlinePayments = useOnlinePayments();
  const validity =
    pkg.validity_days != null ? `Valid ${pkg.validity_days} days from your first class` : "No expiry";

  const ctaClass = cn(CARD_BUTTON, isClaiming && "opacity-70 cursor-wait");

  return (
    <PackageCard
      name={pkg.name}
      headline={`${credits} ${credits === 1 ? "credit" : "credits"}`}
      sub={validity}
      badge="Trial"
      highlight
      price={<PriceBlock pkg={pkg} />}
      features={["Any group class, any location"]}
    >
      {disabled ? (
        <DisabledButton>{disabledReason}</DisabledButton>
      ) : blockedByPayments(onlinePayments, pkg.effective_price_sgd) ? (
        // A priced trial at a studio that takes no online payments (#293).
        <p className="text-sm text-muted text-center">{NO_ONLINE_PAYMENTS}</p>
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
    </PackageCard>
  );
}

// The studio's trial terms, accepted AFTER the member clicks purchase and BEFORE
// checkout. Only shown when the studio has written terms (`trial.terms`).
function TrialTermsModal({
  pkg,
  terms,
  acknowledgement,
  onCancel,
  onConfirm,
}: {
  pkg: ApiClassPackage;
  terms: string;
  acknowledgement: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [ack, setAck] = useState(false);
  useBodyScrollLock(true);
  const isFree = Number(pkg.effective_price_sgd) === 0;
  return (
    <div className={SHEET_BACKDROP} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-terms-title"
        className={SHEET_PANEL}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className={SHEET_HANDLE} />
        <h3 id="trial-terms-title" className={SHEET_TITLE}>
          Trial pass terms
        </h3>
        <p className={cn(NOTE, "mt-3 max-h-[40dvh] overflow-y-auto leading-relaxed whitespace-pre-line text-ink/80")}>
          {terms}
        </p>

        <label className="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-ink/30 accent-[var(--color-accent)]"
          />
          <span>{acknowledgement}</span>
        </label>

        <div className={SHEET_ACTIONS}>
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="button" disabled={!ack} onClick={onConfirm} className={BTN_PRIMARY}>
            {isFree ? "Claim trial pass" : "Continue to payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PtCard({ pkg }: { pkg: ApiPtPackage }) {
  const perSession = Math.round(Number(pkg.effective_price_sgd) / pkg.num_sessions);
  return (
    <PackageCard
      name={pkg.name}
      headline={`${pkg.num_sessions} ${pkg.num_sessions === 1 ? "session" : "sessions"}`}
      sub={`Valid ${pkg.validity_days} ${pkg.validity_days === 1 ? "day" : "days"} from your first request`}
      badge={promo(pkg)}
      price={
        <div className="flex items-baseline justify-between gap-2">
          <PriceBlock pkg={pkg} />
          <span className="text-xs text-muted">{formatSgd(perSession)}/session</span>
        </div>
      }
      features={[
        ...(pkg.session_type === "2on1" ? ["For you and one partner"] : []),
        // Only an Instructor-Bound package promises one coach. An open package
        // is open to any instructor, so the old unconditional promise was one
        // the studio had not made.
        pkg.instructor_bound ? "The same instructor every session" : "Any instructor",
        "Any location",
      ]}
    >
      <BuyButton
        target={{ kind: "package", packageKind: "pt", packageId: pkg.id }}
        context="buy a package"
        gateHref="/packages"
        priceSgd={pkg.effective_price_sgd}
        className={CARD_BUTTON}
      >
        Purchase
      </BuyButton>
    </PackageCard>
  );
}

// ── Corporate ─────────────────────────────────────────────────────────────────

function CorporateSection({ items }: { items: ApiCorporatePackage[] }) {
  const whatsapp = corporateContactWhatsappHref(useBrandCopy(WHATSAPP_COPY_KEY, ""));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Classes at your workplace. Send a request and we&apos;ll arrange dates, venue and
        instructor with you on WhatsApp.
      </p>

      {items.length === 0 ? (
        <div className={cn(CARD, "px-6 py-10 text-center text-sm text-muted")}>
          No corporate packages on offer right now.
        </div>
      ) : (
        <div className={PACKAGE_GRID}>
          {items.map((p) => (
            <CorporateCard key={p.id} pkg={p} />
          ))}
        </div>
      )}

      {/* Only when the studio published a number — see `corporateWhatsappHref`. */}
      {whatsapp && (
        <div className={cn(CARD, "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5")}>
          <div>
            <p className="font-semibold text-ink">Have a question first?</p>
            <p className="text-sm text-muted">Message us before you send a request.</p>
          </div>
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(BTN_SECONDARY, "min-h-[44px] shrink-0")}
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp us
          </a>
        </div>
      )}
    </div>
  );
}

function CorporateCard({ pkg }: { pkg: ApiCorporatePackage }) {
  const { isSignedIn } = useMemberSession();
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
    <div className={cn(CARD, "flex flex-col p-5 sm:p-6")}>
      <p className="font-bold text-ink">{pkg.name}</p>
      {pkg.description && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{pkg.description}</p>
      )}
      <p className="mt-4 text-xl font-bold text-ink">{formatSgd(pkg.price_sgd)}</p>
      <div className="mt-auto pt-5" />
      {err && (
        <p className="mb-2 text-xs text-error">Couldn&apos;t send your request. Try again.</p>
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
        className={cn(CARD_BUTTON, pending && "opacity-70 cursor-wait")}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Sending…" : "Request"}
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
    <div className={SHEET_BACKDROP} onClick={pending ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="corporate-request-title"
        className={SHEET_PANEL}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className={SHEET_HANDLE} />
        <h3 id="corporate-request-title" className={SHEET_TITLE}>
          Request {pkg.name}
        </h3>
        <p className={SHEET_TEXT}>We&apos;ll contact you to confirm the details.</p>

        {/* Where */}
        <div className="mt-5" role="radiogroup" aria-labelledby="corporate-where-label">
          <p id="corporate-where-label" className="text-sm font-semibold text-ink">
            Where
          </p>
          <div className="mt-2 space-y-2">
            {studioOptions.map((name) => (
              <label
                key={name}
                className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-ink/10 px-3.5 text-sm text-ink cursor-pointer transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/5"
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
            <label className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-ink/10 px-3.5 text-sm text-ink cursor-pointer transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/5">
              <input
                type="radio"
                name="corporate-where"
                value={CUSTOM}
                checked={where === CUSTOM}
                onChange={(e) => setWhere(e.target.value)}
                className="h-4 w-4 border-ink/30 text-accent focus:ring-accent"
              />
              <span>Your own venue</span>
            </label>
          </div>
          {isCustom && (
            <>
              <input
                type="text"
                aria-label="Venue address"
                value={customWhere}
                onChange={(e) => setCustomWhere(e.target.value)}
                placeholder="Address or venue name"
                className="mt-2 w-full min-h-[44px] rounded-xl border border-ink/15 bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="mt-2 text-xs text-muted">
                Usually adds a {formatSgd(CORPORATE_TRANSPORT_SURCHARGE_SGD)} transport fee.
                We&apos;ll confirm it in your quote.
              </p>
            </>
          )}
        </div>

        {/* Notes */}
        <div className="mt-5">
          <label htmlFor="corporate-notes" className="block text-sm font-semibold text-ink">
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="corporate-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Group size, preferred dates and times, anything else"
            className="mt-2 w-full rounded-xl border border-ink/15 bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />
        </div>

        {/* Indicative price — nothing is charged here; the studio confirms the
            final quote when arranging the sessions. */}
        <dl className="mt-5 space-y-1 border-t border-ink/5 pt-4 text-sm">
          <div className="flex items-center justify-between font-semibold text-ink">
            <dt>{pkg.name}</dt>
            <dd>{formatSgd(pkg.price_sgd)}</dd>
          </div>
          <p className="text-xs text-muted">
            Nothing to pay now. We confirm the final quote{isCustom ? ", with transport," : ""} when
            we contact you.
          </p>
        </dl>

        {submitError && (
          <p className="mt-4 rounded-xl border border-error/25 bg-error/10 px-3 py-2 text-sm text-ink">
            Couldn&apos;t send your request. Try again.
          </p>
        )}

        <div className={SHEET_ACTIONS}>
          <button type="button" disabled={pending} onClick={onCancel} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="button" disabled={!canSubmit} onClick={handleSubmit} className={BTN_PRIMARY}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
