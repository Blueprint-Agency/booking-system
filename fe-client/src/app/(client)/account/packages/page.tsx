"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Ticket } from "lucide-react";
import { cn, formatExpiryDate, formatSgd } from "@/lib/utils";
import { coversAllLocations } from "@/lib/package-coverage";
import { AllLocationsRow, CoversRow, LocationChip } from "@/components/ui/location-chip";
import { useLocations } from "@/lib/classes";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { StickyFilters } from "@/components/ui/sticky-filters";
import { OpenPurchases } from "@/components/account/open-purchases";
import { CreditHistoryDisclosure } from "@/components/account/credit-history";
import { ContentLoading } from "@/components/ui/content-loading";
import { EmptyState } from "@/components/ui/empty-state";
import { BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { useClientPackages, type LivePackage } from "@/lib/use-client-packages";
import { usePartPaymentOptions, useOpenPurchases } from "@/lib/open-purchases";

type Filter = "current" | "active" | "dormant" | "ended";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "current", label: "Current" },
  { value: "active", label: "Active" },
  { value: "dormant", label: "Not started" },
  { value: "ended", label: "Ended" },
];

type Held = LivePackage & { ended: boolean };

/**
 * What a Dormant package promises, with the length attached. Every kind
 * waits Dormant until the first booking it pays for; a PT package starts when
 * the studio schedules the first session it pays for, not when the member
 * asks for one (be/docs/adr/0011).
 */
function dormantLine(pkg: LivePackage): string {
  const start =
    pkg.kind === "pt"
      ? "Starts when the studio schedules your first session with it"
      : "Starts the first time you book with it";
  if (pkg.validityDays == null) return start;
  return `${start} · lasts ${pkg.validityDays} ${pkg.validityDays === 1 ? "day" : "days"} from then`;
}

/**
 * "Your packages": every package the member has bought — running, waiting for
 * its first booking, or ended — each saying which, so a Dormant one is never
 * passed off as active. Current (running and not started) is the default.
 */
export default function YourPackagesPage() {
  const { packages: live, endedPackages, crossLocation, loading } = useClientPackages();
  const { data: locations } = useLocations();
  const { purchases: openPurchases, failed: openPurchasesFailed } = useOpenPurchases();
  const partPayment = usePartPaymentOptions();
  const [filter, setFilter] = useState<Filter>("current");

  const held: Held[] = useMemo(
    () => [
      // Running first, soonest-ending first; then those still waiting to start.
      ...[...live]
        .sort((a, b) => Number(a.dormant) - Number(b.dormant) || (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""))
        .map((p) => ({ ...p, ended: false })),
      // Ended: the most recently ended first.
      ...[...endedPackages]
        .sort((a, b) => (b.expiresAt ?? b.purchasedAt).localeCompare(a.expiresAt ?? a.purchasedAt))
        .map((p) => ({ ...p, ended: true })),
    ],
    [live, endedPackages],
  );

  const inFilter = (p: Held, f: Filter) =>
    f === "ended" ? p.ended : f === "active" ? !p.ended && !p.dormant : f === "dormant" ? !p.ended && p.dormant : !p.ended;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, held.filter((p) => inFilter(p, f.value)).length]));
  const shown = held.filter((p) => inFilter(p, filter));

  return (
    <div>
      <AccountPageHeader
        title="My packages"
        action={
          <Link href="/packages" className={cn(BTN_PRIMARY, "hidden sm:inline-flex min-h-[44px]")}>
            <Plus className="h-4 w-4" aria-hidden />
            Buy a package
          </Link>
        }
      />

      {/* Money paid that has granted nothing yet (#93). */}
      <div className="mb-6 empty:hidden [&>*:first-child]:mt-0">
        <OpenPurchases purchases={openPurchases} partPayment={partPayment} failed={openPurchasesFailed} />
      </div>

      <StickyFilters className="mb-4">
        <SegmentedTabs
          label="Package status"
          tabs={FILTERS}
          value={filter}
          onChange={setFilter}
          counts={loading ? undefined : counts}
          centered
          className="mb-0"
        />
      </StickyFilters>

      {loading ? (
        <ContentLoading label="Loading your packages" />
      ) : shown.length === 0 ? (
        <div className={CARD}>
          <EmptyState
            icon={Ticket}
            title={
              filter === "ended"
                ? "No ended packages"
                : filter === "dormant"
                  ? "No packages waiting to start"
                  : "No packages yet"
            }
            description={
              filter === "ended" ? undefined : "A class bundle, Unlimited pass or PT package unlocks booking."
            }
            cta={filter === "ended" ? undefined : { href: "/packages", label: "Browse packages" }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((p) => (
            <PackageCard
              key={p.id}
              pkg={p}
              // The one Location this plan does not Cover, for the Add-On offer.
              // Presentation only — `covers()` in the backend stays the enforcement.
              otherLocationName={
                p.kind === "pt" ? null : (locations?.find((l) => l.id !== p.location?.id)?.name ?? null)
              }
              rateSgd={crossLocation.rateSgd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PackageCard({
  pkg,
  otherLocationName,
  rateSgd,
}: {
  pkg: Held;
  otherLocationName?: string | null;
  rateSgd?: string;
}) {
  const isUnlimited = pkg.kind === "unlimited";
  const isPt = pkg.kind === "pt";
  const unitLabel = isPt ? "sessions" : "credits";
  const expired = pkg.ended && pkg.expiresAt != null && new Date(pkg.expiresAt).getTime() <= Date.now();
  const state = pkg.ended
    ? { label: expired ? "Expired" : "Used up", tone: "text-muted" }
    : pkg.dormant
      ? { label: "Not started", tone: "text-ink" }
      : { label: "Active", tone: "text-sage" };
  // Held back until the rate has loaded, so the card never offers it at S$0.
  const offerAddOn = !pkg.ended && otherLocationName && Number(rateSgd) > 0;

  return (
    <div className={cn(CARD, "p-4 sm:p-5", pkg.ended && "bg-card/60 shadow-none")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Kind and state as one quiet line, as My bookings' cards read. */}
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-bold uppercase leading-none tracking-wider">
            <span className={isPt ? "text-gold-deep" : "text-accent-deep"}>
              {isPt ? "Private" : isUnlimited ? "Unlimited" : "Classes"}
            </span>
            <span aria-hidden className="text-ink/20">
              ·
            </span>
            <span className={state.tone}>{state.label}</span>
          </p>
          <p className={cn("mt-1.5 font-semibold break-words", pkg.ended ? "text-muted" : "text-ink")}>{pkg.name}</p>
          <p className="mt-1 text-xs text-muted">
            {pkg.ended
              ? expired
                ? `Expired ${formatExpiryDate(pkg.expiresAt!)}`
                : `Every ${isPt ? "session" : "credit"} used`
              : pkg.dormant
                ? dormantLine(pkg)
                : `Expires ${formatExpiryDate(pkg.expiresAt!)}`}
          </p>
          {/* Shown only when the backend says it is bound — an open package
              says nothing rather than promising "any instructor". */}
          {pkg.boundInstructor && (
            <p className="mt-1 text-xs text-muted">
              Sessions with <span className="text-ink">{pkg.boundInstructor.name}</span>
            </p>
          )}
          {!pkg.ended && isUnlimited && pkg.location && (
            <CoversRow className="mt-2">
              <LocationChip name={pkg.location.name} />
              {pkg.crossLocationPaidSgd !== null && (
                <LocationChip
                  name={otherLocationName ?? "Both studios"}
                  until={pkg.expiresAt ? formatExpiryDate(pkg.expiresAt) : null}
                />
              )}
            </CoversRow>
          )}
          {!pkg.ended && (coversAllLocations(pkg.kind) || isPt) && <AllLocationsRow className="mt-2" />}
        </div>
        {!pkg.ended && (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-extrabold leading-none text-ink tabular-nums">
              {isUnlimited ? "∞" : pkg.creditsOrSessionsRemaining}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {isUnlimited ? "Unlimited" : unitLabel}
            </p>
          </div>
        )}
      </div>
      {isUnlimited && pkg.location && pkg.crossLocationPaidSgd === null && offerAddOn && (
        <Link
          href={`/checkout?add_on=${pkg.id}`}
          className="mt-3 flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-accent/5 px-3 text-sm font-semibold text-accent-deep hover:bg-accent/10 transition-colors"
        >
          <span className="min-w-0">
            Add {otherLocationName} for {formatSgd(rateSgd!)}/month
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      )}
      {/* An Unlimited Plan has no balance for credits to move through. */}
      {!isUnlimited && <CreditHistoryDisclosure packageId={pkg.id} unit={isPt ? "session" : "credit"} />}
    </div>
  );
}
