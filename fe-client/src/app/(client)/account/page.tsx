"use client";

import Link from "next/link";
import { ArrowRight, CalendarPlus, ChevronRight } from "lucide-react";
import { cn, formatExpiryDate, formatSgd } from "@/lib/utils";
import { coversAllLocations } from "@/lib/package-coverage";
import { AllLocationsRow, CoversRow, LocationChip } from "@/components/ui/location-chip";
import { useLocations } from "@/lib/classes";
import { ContentLoading } from "@/components/ui/content-loading";
import { ComingUp } from "@/components/account/coming-up";
import { AccountHeader } from "@/components/account/account-header";
import { ACCOUNT_SECTIONS } from "@/components/account/account-nav-items";
import { SignOutButton } from "@/components/account/sign-out-button";
import { useAppUser } from "@/lib/auth";
import { useClientPackages, type LivePackage } from "@/lib/use-client-packages";
import { OpenPurchases } from "@/components/account/open-purchases";
import { CancelledBanner } from "@/components/checkout/cancelled-banner";
import { usePartPaymentOptions, useOpenPurchases } from "@/lib/open-purchases";

/**
 * What a Dormant package promises, with the length attached. Every kind
 * waits Dormant until the first booking it pays for; a PT package starts when
 * the studio schedules the first session it pays for, not when the member
 * asks for one (be/docs/adr/0011). With another package running, that is the
 * booking the member picks it on.
 */
function dormantLine(pkg: LivePackage): string {
  const start =
    pkg.kind === "pt"
      ? "Starts when the studio schedules your first session with it"
      : "Starts the first time you book with it";
  if (pkg.validityDays == null) return start;
  return `${start} · valid ${pkg.validityDays} ${pkg.validityDays === 1 ? "day" : "days"} from then`;
}

const cardClass = "rounded-2xl bg-card border border-ink/5 shadow-soft";

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-bold text-ink">{children}</h2>
      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center gap-0.5 text-sm font-semibold text-accent-deep hover:text-accent"
        >
          {action.label}
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

export default function AccountOverview() {
  const { user } = useAppUser();
  const { packages: livePackages, crossLocation, loading: pkgLoading } = useClientPackages();
  const { data: locations } = useLocations();
  // A balance the member left outstanding (#93). It sits above the packages
  // because it is the one thing on this page waiting on them.
  const { purchases: openPurchases, failed: openPurchasesFailed } = useOpenPurchases();
  const partPayment = usePartPaymentOptions();
  const firstName = user?.firstName || "there";

  // Every live package, each on its own card: several of a Family may run at
  // once (be/docs/adr/0010), so none is singled out as "the current one". The
  // running ones lead, soonest-ending first, then those still waiting to start.
  // A Trial is listed too: it can run beside a bundle.
  const packages = [...livePackages]
    .sort(
      (a, b) =>
        Number(a.dormant) - Number(b.dormant) ||
        (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""),
    );

  return (
    <div>
      <header className="mb-5 md:mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted">Welcome back</p>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink truncate">
            Hi, {firstName}
          </h1>
        </div>
        <Link
          href="/"
          className="hidden sm:inline-flex shrink-0 items-center gap-2 rounded-full bg-ink px-5 min-h-[44px] text-sm font-semibold text-paper hover:bg-ink/90 transition-colors"
        >
          <CalendarPlus className="h-4 w-4" />
          Book a class
        </Link>
      </header>

      {/* Back from a payment page the member left — a standalone Add-On, or
          paying more towards an unfinished purchase (#274). */}
      <CancelledBanner className="mb-6" />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-x-8">
        <div className="min-w-0">
          {/* The class running now or next as the ticket, with its check-in QR
              one tap away (#192); the rest beside it, swiped through. */}
          <ComingUp />

          {/* Unfinished purchases — money paid that has granted nothing yet. */}
          <div className="[&>*:first-child]:mt-0 mb-6 empty:hidden">
            <OpenPurchases
              purchases={openPurchases}
              partPayment={partPayment}
              failed={openPurchasesFailed}
            />
          </div>

        </div>

        <aside className="min-w-0">
          {/* Every package the member holds, running or still waiting for its
              first booking — each card says which, so a Dormant one is never
              passed off as active. */}
          <section aria-labelledby="packages-heading" className="mb-8">
            <SectionTitle action={{ href: "/packages", label: "Buy more" }}>
              <span id="packages-heading">Your packages</span>
            </SectionTitle>
            {pkgLoading ? (
              <ContentLoading label="Loading your packages" className="min-h-24" />
            ) : packages.length === 0 ? (
              <div className={cn(cardClass, "p-5")}>
                <p className="font-semibold text-ink">No packages yet</p>
                <p className="text-sm text-muted mt-0.5">
                  A class bundle, unlimited pass or PT package unlocks booking.
                </p>
                <Link
                  href="/packages"
                  className="mt-4 inline-flex items-center justify-center rounded-full bg-ink px-5 min-h-[44px] text-sm font-semibold text-paper hover:bg-ink/90 transition-colors"
                >
                  Browse packages
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
                {packages.map((p) => (
                  <PackageCard
                    key={p.id}
                    pkg={p}
                    // The studio has exactly two Locations, so the one this plan
                    // does not Cover is simply the other row. Presentation only —
                    // `covers()` in the backend stays the enforcement.
                    otherLocationName={
                      p.kind === "pt"
                        ? null
                        : locations?.find((l) => l.id !== p.location?.id)?.name ?? null
                    }
                    rateSgd={crossLocation.rateSgd}
                  />
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <AccountMenu />
    </div>
  );
}

/**
 * The account's sections as a menu, for phones and tablets where there is no
 * sidebar. It closes the overview rather than opening it: what the member came
 * to see — the next session, their packages — comes first.
 */
function AccountMenu() {
  return (
    <section aria-labelledby="account-menu-heading" className="lg:hidden">
      <h2 id="account-menu-heading" className="mb-3 text-base font-bold text-ink">
        Your account
      </h2>
      <div className={cn(cardClass, "overflow-hidden")}>
        <Link
          href="/account/profile"
          className="flex items-center justify-between gap-3 p-4 border-b border-ink/5 hover:bg-ink/[0.02] transition-colors"
        >
          <AccountHeader size="lg" />
          <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
        </Link>
        <nav aria-label="Account">
          <ul className="divide-y divide-ink/5">
            {ACCOUNT_SECTIONS.map(({ href, label, hint, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 min-h-[60px] hover:bg-ink/[0.02] transition-colors"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/8 text-accent-deep">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{label}</span>
                    <span className="block text-xs text-muted truncate">{hint}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <SignOutButton className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-ink/10 bg-card min-h-[52px] text-sm font-semibold text-error hover:bg-error/5 transition-colors" />
    </section>
  );
}

function PackageCard({
  pkg,
  otherLocationName,
  rateSgd,
}: {
  pkg: LivePackage;
  /** The Location this plan does not already Cover, for the Add-On offer. */
  otherLocationName?: string | null;
  rateSgd?: string;
}) {
  const isUnlimited = pkg.kind === "unlimited";
  const isPt = pkg.kind === "pt";
  const unitLabel = isPt ? "sessions" : "credits";
  // Held back until the rate has loaded, so the card never offers it at S$0.
  const offerAddOn = otherLocationName && Number(rateSgd) > 0;
  return (
    <div className={cn(cardClass, "p-4 sm:p-5")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                isPt ? "bg-cyan/15 text-cyan-deep" : "bg-accent/10 text-accent-deep",
              )}
            >
              {isPt ? "Private" : isUnlimited ? "Unlimited" : "Classes"}
            </span>
            {/* Running, or Dormant until its first booking: said outright, so a
                package that has not started never reads as active. */}
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                pkg.dormant ? "bg-ink/[0.06] text-muted" : "bg-sage/15 text-sage",
              )}
            >
              {pkg.dormant ? "Not started" : "Active"}
            </span>
          </div>
          <p className="mt-1.5 font-semibold text-ink break-words">{pkg.name}</p>
          <p className="text-xs text-muted mt-1">
            {pkg.dormant
              ? dormantLine(pkg)
              : `Expires ${formatExpiryDate(pkg.expiresAt!)}`}
          </p>
          {/* Who this package's sessions are with. Shown only when the backend
              says it is bound — an open package says nothing rather than
              claiming "any instructor", which is a promise nobody made. */}
          {pkg.boundInstructor && (
            <p className="text-xs text-muted mt-1">
              Sessions with{" "}
              <span className="text-ink">{pkg.boundInstructor.name}</span>
            </p>
          )}
          {/* What this plan Covers, one chip per Location. The added one says
              when its coverage ends — losing it is never silent (§5). */}
          {isUnlimited && pkg.location && (
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
          {/* A bundle — a Trial arrives as one — works at every Location. */}
          {coversAllLocations(pkg.kind) && <AllLocationsRow className="mt-2" />}
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-extrabold text-ink tabular-nums leading-none">
            {isUnlimited ? "∞" : pkg.creditsOrSessionsRemaining}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            {isUnlimited ? "Unlimited" : unitLabel}
          </p>
        </div>
      </div>
      {isUnlimited && pkg.location && pkg.crossLocationPaidSgd === null && offerAddOn && (
        <Link
          href={`/checkout?add_on=${pkg.id}`}
          className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-accent/5 px-3 min-h-[44px] text-sm font-semibold text-accent-deep hover:bg-accent/10 transition-colors"
        >
          <span className="min-w-0">
            Add {otherLocationName} for {formatSgd(rateSgd!)}/month
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      )}
    </div>
  );
}
