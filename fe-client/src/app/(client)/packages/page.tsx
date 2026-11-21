"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Check, MessageCircle } from "lucide-react";
import { BuyButton } from "@/components/checkout/buy-button";
import { cn, formatDurationMonths } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { SubTabs } from "@/components/ui/sub-tabs";
import { Select } from "@/components/ui/select";
import { StickyFilters } from "@/components/ui/sticky-filters";
import { Portal } from "@/components/ui/portal";
import { ContentLoading } from "@/components/ui/content-loading";
import { AllLocationsRow, HomeStudioRow } from "@/components/ui/location-chip";
import { coversAllLocations } from "@/lib/package-coverage";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  NOTE,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  ApiClassPackage,
  ApiPtPackage,
  classPackageShape,
  formatSgd,
  hasDiscount,
  isTrialPackage,
  usePackagesCatalog,
} from "@/lib/packages";
import {
  ApiCorporatePackage,
  corporateContactWhatsappHref,
  useCorporatePackages,
  WHATSAPP_COPY_KEY,
} from "@/lib/corporate";
import { useBrandCopy } from "@/components/brand/brand-provider";
import { packagesHref } from "@/lib/entities";
import { usePackagesEntity } from "@/lib/public-entities";
import {
  trialClosedLabel,
  trialClosedText,
  trialStandingFor,
  type TrialStanding,
  type TrialType,
} from "@/lib/trial-standing";

// ── Tab definitions ────────────────────────────────────────────────────────────

type MainTab = "group" | "private" | "corporate";
type ClassSubTab = "bundle" | "unlimited";
type PrivateSubTab = "1on1" | "2on1";

/**
 * What the cards need to sell a trial: whether this member may take it, and
 * the studio's terms step before the purchase goes on. A trial sits among the
 * packages of its own kind — a credit bundle trial with the bundles, a 1-on-1
 * trial with the 1-on-1 packages — first, with a Trial badge.
 */
interface TrialSale {
  standingOf: (pkg: ApiClassPackage | ApiPtPackage, type: TrialType) => TrialStanding;
  /** The Entity a closed trial's note names; null when the page shows one Entity's. */
  entityNameOf: (pkg: ApiClassPackage | ApiPtPackage) => string | null;
  /** The studio's terms step, or undefined when it has written none. */
  beforeProceed: ((proceed: () => void) => void) | undefined;
}

/** A tab's packages with its trials first, keeping the catalogue's order otherwise. */
function trialsFirst<P extends ApiClassPackage | ApiPtPackage>(pkgs: P[]): P[] {
  return [...pkgs].sort((a, b) => Number(isTrialPackage(b)) - Number(isTrialPackage(a)));
}

/**
 * The studio's own terms for its trials — who may buy one and what happens
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
  // `/packages` has no slug and `/packages/<slug>` renders this same page: a
  // studio with two or more Entities with packages shows one Entity's at a time.
  const routeParams = useParams<{ entity?: string }>();
  const router = useRouter();
  const { entity, entities } = usePackagesEntity(routeParams.entity);
  // Set only for a studio with two or more Entities selling packages.
  const currentEntity = entities?.find((e) => e.slug === entity);
  const { data, loading, error } = usePackagesCatalog(entity);
  const {
    data: corporateData,
    loading: corporateLoading,
    error: corporateError,
    refresh: refreshCorporate,
  } = useCorporatePackages(entity);
  const [activeTab, setActiveTab] = useState<MainTab>("group");
  const [classSubTab, setClassSubTab] = useState<ClassSubTab>("bundle");
  const [privateSubTab, setPrivateSubTab] = useState<PrivateSubTab>("1on1");
  // `#trial`: open the first tab holding a trial, once the catalogue is here.
  const [wantsTrial, setWantsTrial] = useState(false);
  // The rest of a trial purchase, waiting on the member accepting the studio's terms.
  const [pendingTerms, setPendingTerms] = useState<(() => void) | null>(null);
  const trialTerms = useBrandCopy(TRIAL_TERMS_COPY_KEY, "");
  const trialAck = useBrandCopy(TRIAL_ACK_COPY_KEY, "I have read and accept these terms.");

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
      if (h === "trial" || h === "trial-pass") {
        setWantsTrial(true);
        return none;
      }
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
    () => trialsFirst((data?.classPackages ?? []).filter((p) => classPackageShape(p) === "credit_bundle")),
    [data],
  );
  const unlimited = useMemo(
    () => trialsFirst((data?.classPackages ?? []).filter((p) => classPackageShape(p) === "unlimited")),
    [data],
  );
  const pt1on1 = useMemo(
    () => trialsFirst((data?.ptPackages ?? []).filter((p) => p.session_type === "1on1")),
    [data],
  );
  const pt2on1 = useMemo(
    () => trialsFirst((data?.ptPackages ?? []).filter((p) => p.session_type === "2on1")),
    [data],
  );

  // `#trial` opens the first tab that holds a trial, in the page's own order.
  useEffect(() => {
    if (!wantsTrial || !data) return;
    setWantsTrial(false);
    const first = (
      [
        [bundles, "group", "bundle", null],
        [unlimited, "group", "unlimited", null],
        [pt1on1, "private", null, "1on1"],
        [pt2on1, "private", null, "2on1"],
      ] as const
    ).find(([pkgs]) => pkgs.some(isTrialPackage));
    if (!first) return;
    const [, main, sub, priv] = first;
    setActiveTab(main);
    if (sub) setClassSubTab(sub);
    if (priv) setPrivateSubTab(priv);
  }, [wantsTrial, data, bundles, unlimited, pt1on1, pt2on1]);

  const corporate = useMemo(
    () => (corporateData ?? []).filter((p) => p.status === "active"),
    [corporateData],
  );

  const ent = data?.entitlements ?? null;
  const hasUnlimited = ent?.has_active_unlimited ?? false;
  const hasBundle = ent?.has_active_bundle_credits ?? false;
  // A trial is for a member new to its type in its Entity, so each one reads
  // that standing. Signed out (entitlements null) every trial reads open — the
  // auth gate runs on click.
  const trials = [...bundles, ...unlimited, ...pt1on1, ...pt2on1].filter(isTrialPackage);
  // The sentence names the Entity only when trials of several are on the page.
  const namesEntities = new Set(trials.map((p) => p.entity_id ?? null)).size > 1;
  const trialSale: TrialSale = {
    standingOf: (pkg, type) => trialStandingFor(ent, pkg.entity_id, type),
    entityNameOf: (pkg) => (namesEntities ? (pkg.entity?.name ?? null) : null),
    // Terms to accept → the acknowledgement step first; none → straight on.
    beforeProceed: trialTerms ? (proceed) => setPendingTerms(() => proceed) : undefined,
  };

  const MAIN_TABS: { key: MainTab; label: string; hidden?: boolean }[] = [
    { key: "group", label: "Group" },
    { key: "private", label: "Private" },
    { key: "corporate", label: "Corporate" },
  ];

  return (
    <>
      <BookingSurface>
          {/* A studio selling under several Entities titles the page with the one shown. On a
              phone the title is itself the switcher, a dropdown that holds any number of
              Entities; from `md` up the side rail switches and the title is plain. */}
          <PageHeader
            title={currentEntity?.name ?? "Packages"}
            phoneSwitcher={
              entities && currentEntity ? (
                <Select
                  ariaLabel="Packages for"
                  value={currentEntity.slug}
                  options={entities.map((e) => ({ value: e.slug, label: e.name }))}
                  onChange={(slug) => router.push(packagesHref(slug))}
                  className="inline-block max-w-full"
                  triggerClassName="w-auto max-w-full min-h-[44px] gap-1.5 rounded-lg border-0 bg-transparent px-0 text-2xl font-extrabold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-accent [&>svg]:size-5 [&>svg]:text-ink"
                />
              ) : undefined
            }
          />

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
              <StickyFilters className="mb-4">
                <SegmentedTabs
                  label="Package family"
                  centered
                  tabs={MAIN_TABS.filter((t) => !t.hidden).map((t) => ({ value: t.key, label: t.label }))}
                  value={activeTab}
                  onChange={setActiveTab}
                  className="mb-0"
                />
              </StickyFilters>

              {/* ── Group tab ───────────────────────────────────────── */}
              {activeTab === "group" && (
                <ClassCreditsSection
                  bundles={bundles}
                  unlimited={unlimited}
                  subTab={classSubTab}
                  setSubTab={setClassSubTab}
                  hasUnlimited={hasUnlimited}
                  hasBundle={hasBundle}
                  trialSale={trialSale}
                />
              )}

              {/* ── Private (PT) tab ────────────────────────────────── */}
              {activeTab === "private" && (
                <PrivateSection
                  pt1on1={pt1on1}
                  pt2on1={pt2on1}
                  subTab={privateSubTab}
                  setSubTab={setPrivateSubTab}
                  trialSale={trialSale}
                />
              )}

              {/* ── Corporate tab ───────────────────────────────────── */}
              {activeTab === "corporate" && (
                <CorporateSection
                  items={corporate}
                  state={corporateError ? "failed" : corporateLoading || corporateData === null ? "loading" : "ready"}
                  onRetry={() => void refreshCorporate()}
                />
              )}
            </>
          )}
      </BookingSurface>

      {pendingTerms && (
        <TrialTermsModal
          terms={trialTerms}
          acknowledgement={trialAck}
          onCancel={() => setPendingTerms(null)}
          onConfirm={() => {
            setPendingTerms(null);
            pendingTerms();
          }}
        />
      )}
    </>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

const SHARED_BLURBS = {
  pt1on1: "One-to-one time with an instructor. 1 session = 60 min.",
  pt2on1: "Train with a partner and share the cost. 1 session = 60 min.",
};

/**
 * One sentence per closed trial in a tab, above its cards: a used trial is
 * told it was used, one the member is not new to who it is for. One per Entity
 * (one at a studio with a single Entity).
 */
function ClosedTrialNotes({
  pkgs,
  type,
  trialSale,
}: {
  pkgs: (ApiClassPackage | ApiPtPackage)[];
  type: TrialType;
  trialSale: TrialSale;
}) {
  const notes = new Map<string, string>();
  for (const p of pkgs) {
    if (!isTrialPackage(p)) continue;
    const standing = trialSale.standingOf(p, type);
    if (standing.eligible) continue;
    const name = trialSale.entityNameOf(p);
    notes.set(name ?? "", trialClosedText(standing.used, name, type));
  }
  return (
    <>
      {[...notes.values()].map((text) => (
        <p key={text} className={NOTE}>
          {text}
        </p>
      ))}
    </>
  );
}

/**
 * The trial side of a card: its badge, and a closed trial's button in place of
 * the purchase. Null for a package that is no trial.
 */
function trialCardProps(
  pkg: ApiClassPackage | ApiPtPackage,
  type: TrialType,
  trialSale: TrialSale,
): { closed: string | null; beforeProceed: TrialSale["beforeProceed"] } | null {
  if (!isTrialPackage(pkg)) return null;
  const standing = trialSale.standingOf(pkg, type);
  return {
    closed: standing.eligible ? null : trialClosedLabel(standing),
    beforeProceed: trialSale.beforeProceed,
  };
}

function ClassCreditsSection({
  bundles,
  unlimited,
  subTab,
  setSubTab,
  hasUnlimited,
  hasBundle,
  trialSale,
}: {
  bundles: ApiClassPackage[];
  unlimited: ApiClassPackage[];
  subTab: ClassSubTab;
  setSubTab: (s: ClassSubTab) => void;
  hasUnlimited: boolean;
  hasBundle: boolean;
  trialSale: TrialSale;
}) {
  const subTabs: { key: ClassSubTab; label: string }[] = [
    { key: "bundle", label: "Credit bundles" },
    { key: "unlimited", label: "Unlimited" },
  ];

  return (
    <div className="space-y-4">
      <SubTabs
        label="Class package type"
        centered
        tabs={subTabs.map((t) => ({ value: t.key, label: t.label }))}
        value={subTab}
        onChange={setSubTab}
      />

      {/* Nothing blocks a purchase on top of what the member holds: every
          package waits Dormant and starts on the first booking it pays for
          (§3). Several may run at once and the member picks which one pays on
          the Book sheet, so a member holding one is told the new one waits
          until they book with it, not refused. */}
      {subTab === "bundle" && (
        <>
          {(hasUnlimited || hasBundle) && (
            <p className={NOTE}>
              You already have a {hasUnlimited ? "class pass" : "credit bundle"}. A new bundle
              starts the first time you book a class with it.
            </p>
          )}
          <ClosedTrialNotes pkgs={bundles} type="group" trialSale={trialSale} />
          {bundles.length === 0 ? (
            <EmptyCatalog kind="bundle" />
          ) : (
            <div className={PACKAGE_GRID}>
              {bundles.map((p) => (
                <BundleCard key={p.id} pkg={p} trial={trialCardProps(p, "group", trialSale)} />
              ))}
            </div>
          )}
        </>
      )}

      {subTab === "unlimited" && (
        <>
          {hasBundle && !hasUnlimited && (
            <p className={NOTE}>
              You still have class credits. A new pass starts the first time you book a
              class with it.
            </p>
          )}
          {hasUnlimited && (
            <p className={NOTE}>
              You already have an Unlimited pass. A new one starts the first time you book a
              class with it, and can be for any home studio.
            </p>
          )}
          <ClosedTrialNotes pkgs={unlimited} type="group" trialSale={trialSale} />
          {unlimited.length === 0 ? (
            <EmptyCatalog kind="unlimited" />
          ) : (
            <div className={PACKAGE_GRID}>
              {unlimited.map((p) => (
                <UnlimitedCard key={p.id} pkg={p} trial={trialCardProps(p, "group", trialSale)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PrivateSection({
  pt1on1,
  pt2on1,
  subTab,
  setSubTab,
  trialSale,
}: {
  pt1on1: ApiPtPackage[];
  pt2on1: ApiPtPackage[];
  subTab: PrivateSubTab;
  setSubTab: (s: PrivateSubTab) => void;
  trialSale: TrialSale;
}) {
  const subTabs: { key: PrivateSubTab; label: string }[] = [
    { key: "1on1", label: "1-on-1" },
    { key: "2on1", label: "2-on-1" },
  ];

  return (
    <div className="space-y-4">
      <SubTabs
        label="Private session type"
        centered
        tabs={subTabs.map((t) => ({ value: t.key, label: t.label }))}
        value={subTab}
        onChange={setSubTab}
      />

      {subTab === "1on1" && (
        <PtSection items={pt1on1} type="1on1" blurb={SHARED_BLURBS.pt1on1} trialSale={trialSale} />
      )}
      {subTab === "2on1" && (
        <PtSection items={pt2on1} type="2on1" blurb={SHARED_BLURBS.pt2on1} trialSale={trialSale} />
      )}
    </div>
  );
}

function PtSection({
  items,
  type,
  blurb,
  trialSale,
}: {
  items: ApiPtPackage[];
  type: "1on1" | "2on1";
  blurb: string;
  trialSale: TrialSale;
}) {
  if (items.length === 0) {
    return <EmptyCatalog kind="pt" />;
  }
  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted">{blurb}</p>
      <ClosedTrialNotes pkgs={items} type={type} trialSale={trialSale} />
      <div className={PACKAGE_GRID}>
        {items.map((p) => (
          <PtCard key={p.id} pkg={p} trial={trialCardProps(p, type, trialSale)} />
        ))}
      </div>
    </div>
  );
}

function EmptyCatalog({ kind }: { kind: "bundle" | "unlimited" | "pt" }) {
  const copy = {
    bundle: "No credit bundles on sale right now.",
    unlimited: "No Unlimited passes on sale right now.",
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
  covers = null,
  highlight = false,
  children,
}: {
  name: string;
  headline: string;
  sub?: string;
  badge?: string | null;
  price: React.ReactNode;
  features?: string[];
  /** Where it can be used, as chips under the validity line. */
  covers?: "all" | "home" | null;
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
      {covers === "all" && <AllLocationsRow className="mt-2.5" />}
      {covers === "home" && <HomeStudioRow className="mt-2.5" />}
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

/**
 * How long a package lasts and when its clock starts: never at purchase, but
 * at the first class booked with it — for PT, the first session the studio
 * schedules (§3). The number is the studio's own `validity_days`.
 */
function validityLine(days: number | null | undefined, first: "class" | "session"): string {
  if (days == null) return "No expiry";
  return `Use within ${days} ${days === 1 ? "day" : "days"} of your first ${first}`;
}

const promo = (pkg: ApiClassPackage | ApiPtPackage) => (hasDiscount(pkg) ? "Promo" : null);

/** The trial side of a card (`trialCardProps`); null for a package that is no trial. */
type CardTrial = ReturnType<typeof trialCardProps>;

/** A trial says so on its badge, ahead of a Promo: its price is the offer. */
const badgeOf = (pkg: ApiClassPackage | ApiPtPackage, trial: CardTrial) => (trial ? "Trial" : promo(pkg));

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

function BundleCard({ pkg, trial }: { pkg: ApiClassPackage; trial: CardTrial }) {
  const credits = pkg.credits ?? 0;
  // Signing in returns to this page, on this Entity.
  const here = usePathname();
  return (
    <PackageCard
      name={pkg.name}
      headline={`${credits} ${credits === 1 ? "credit" : "credits"}`}
      sub={validityLine(pkg.validity_days, "class")}
      covers={coversAllLocations(classPackageShape(pkg)) ? "all" : null}
      badge={badgeOf(pkg, trial)}
      highlight={trial !== null}
      price={<PriceBlock pkg={pkg} />}
    >
      {trial?.closed ? (
        <DisabledButton>{trial.closed}</DisabledButton>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "class", packageId: pkg.id }}
          context="buy a package"
          itemName={pkg.name}
          gateHref={here}
          priceSgd={pkg.effective_price_sgd}
          beforeProceed={trial?.beforeProceed}
          className={CARD_BUTTON}
        >
          Purchase
        </BuyButton>
      )}
    </PackageCard>
  );
}

function UnlimitedCard({ pkg, trial }: { pkg: ApiClassPackage; trial: CardTrial }) {
  const here = usePathname();
  const months =
    pkg.duration_months != null
      ? formatDurationMonths(pkg.duration_months)
      : "Unlimited";
  return (
    <PackageCard
      name={pkg.name}
      headline={months}
      sub="Starts at your first class"
      covers="home"
      badge={badgeOf(pkg, trial)}
      highlight={trial !== null}
      price={<PriceBlock pkg={pkg} />}
      features={["Unlimited group classes", "No weekly class limit"]}
    >
      {trial?.closed ? (
        <DisabledButton>{trial.closed}</DisabledButton>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "class", packageId: pkg.id }}
          context="buy a package"
          itemName={pkg.name}
          gateHref={here}
          priceSgd={pkg.effective_price_sgd}
          // A plan has a Home studio to pick, at every price — including one a
          // Promotion took to zero.
          requiresReview
          beforeProceed={trial?.beforeProceed}
          className={CARD_BUTTON}
        >
          Purchase
        </BuyButton>
      )}
    </PackageCard>
  );
}

// The studio's trial terms, accepted AFTER the member clicks purchase on any
// trial and BEFORE checkout. Only shown when the studio has written terms
// (`trial.terms`).
function TrialTermsModal({
  terms,
  acknowledgement,
  onCancel,
  onConfirm,
}: {
  terms: string;
  acknowledgement: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [ack, setAck] = useState(false);
  useBodyScrollLock(true);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <Portal>
    <div className={SHEET_BACKDROP} onClick={onCancel}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-terms-title"
        tabIndex={-1}
        className={SHEET_PANEL}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <span aria-hidden className={SHEET_HANDLE} />
        <h3 id="trial-terms-title" className={SHEET_TITLE}>
          Trial terms
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
            {/* On with the purchase: who it is billed to, or the review page. */}
            Continue
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function PtCard({ pkg, trial }: { pkg: ApiPtPackage; trial: CardTrial }) {
  const here = usePathname();
  const perSession = Math.round(Number(pkg.effective_price_sgd) / pkg.num_sessions);
  return (
    <PackageCard
      name={pkg.name}
      headline={`${pkg.num_sessions} ${pkg.num_sessions === 1 ? "session" : "sessions"}`}
      sub={validityLine(pkg.validity_days, "session")}
      covers="all"
      badge={badgeOf(pkg, trial)}
      highlight={trial !== null}
      price={
        <div className="flex items-baseline justify-between gap-2">
          <PriceBlock pkg={pkg} />
          <span className="text-xs text-muted">{formatSgd(perSession)}/session</span>
        </div>
      }
      features={[
        ...(pkg.session_type === "2on1" ? ["For you and one partner"] : []),
        // Only an Instructor-Bound package promises one coach. An open package
        // is open to any instructor, so promising one coach would be a promise
        // the studio had not made.
        pkg.instructor_bound ? "The same instructor every session" : "Any instructor, subject to availability",
      ]}
    >
      {trial?.closed ? (
        <DisabledButton>{trial.closed}</DisabledButton>
      ) : (
        <BuyButton
          target={{ kind: "package", packageKind: "pt", packageId: pkg.id }}
          context="buy a package"
          itemName={pkg.name}
          gateHref={here}
          priceSgd={pkg.effective_price_sgd}
          // An Instructor-Bound package has its instructor to pick on the review
          // page at every price, a free trial included.
          requiresReview={pkg.instructor_bound}
          beforeProceed={trial?.beforeProceed}
          className={CARD_BUTTON}
        >
          Purchase
        </BuyButton>
      )}
    </PackageCard>
  );
}

// ── Corporate ─────────────────────────────────────────────────────────────────

/**
 * `state` keeps a read that failed (or has not answered) apart from a studio
 * with none on offer: "none on offer" is a claim a member would repeat
 * to their employer, so it is made only when the read said so.
 */
function CorporateSection({
  items,
  state,
  onRetry,
}: {
  items: ApiCorporatePackage[];
  state: "loading" | "failed" | "ready";
  onRetry: () => void;
}) {
  const whatsapp = corporateContactWhatsappHref(useBrandCopy(WHATSAPP_COPY_KEY, ""));
  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted">
        Classes at your workplace. Buy a package and we&apos;ll arrange dates, venue and
        instructor with you on WhatsApp.
      </p>

      {state === "failed" ? (
        <div className={cn(CARD, "px-6 py-10 text-center text-sm text-muted")} role="alert">
          <p>Couldn&apos;t load corporate packages.</p>
          <button type="button" onClick={onRetry} className={cn(BTN_SECONDARY, "mt-4 min-h-[44px]")}>
            Try again
          </button>
        </div>
      ) : state === "loading" ? (
        <ContentLoading label="Loading corporate packages" className="min-h-32" />
      ) : items.length === 0 ? (
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
            <p className="text-sm text-muted">Message us before you buy.</p>
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

// Buy goes to the normal checkout (§6.2): paid by card, and the payment sends the
// request. There is no request form — date, venue and headcount are settled with
// the studio on WhatsApp, and the member lands on their corporate bookings.
function CorporateCard({ pkg }: { pkg: ApiCorporatePackage }) {
  const here = usePathname();
  return (
    <div className={cn(CARD, "flex flex-col p-5 sm:p-6")}>
      <p className="font-bold text-ink">{pkg.name}</p>
      {pkg.description && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{pkg.description}</p>
      )}
      <p className="mt-4 text-xl font-bold text-ink">{formatSgd(pkg.price_sgd)}</p>
      <div className="mt-auto pt-5" />
      <BuyButton
        target={{ kind: "package", packageKind: "corporate", packageId: pkg.id }}
        context="buy a package"
        itemName={pkg.name}
        gateHref={`${here}#corporate`}
        priceSgd={pkg.price_sgd}
        className={CARD_BUTTON}
      >
        Buy
      </BuyButton>
    </div>
  );
}
