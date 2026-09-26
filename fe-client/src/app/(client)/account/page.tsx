"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarPlus, ChevronRight, Ticket, UserRound } from "lucide-react";
import { cn, formatDate, formatExpiryDate, formatSgd } from "@/lib/utils";
import { formatClassTime, useLocations } from "@/lib/classes";
import { ContentLoading } from "@/components/ui/content-loading";
import { QrBadge } from "@/components/account/qr-badge";
import { DateStub } from "@/components/account/date-stub";
import { MyNextClass } from "@/components/account/next-class-card";
import { AccountHeader } from "@/components/account/account-header";
import { ACCOUNT_SECTIONS } from "@/components/account/account-nav-items";
import { SignOutButton } from "@/components/account/sign-out-button";
import { useAppUser } from "@/lib/auth";
import { useApi } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import { useClientPackages, type LivePackage } from "@/lib/use-client-packages";
import type { ApiBooking } from "@/components/account/class-bookings";
import { OpenPurchases } from "@/components/account/open-purchases";
import { CancelledBanner } from "@/components/checkout/cancelled-banner";
import { usePartPaymentOptions, useOpenPurchases } from "@/lib/open-purchases";

const PAGE_SIZE = 5;

/** What a Dormant package says on both member surfaces (spec §8). */
const ACTIVATION_LINE = "Starts when you book your first class";

/**
 * The same promise with the length attached, for a package card. Every kind
 * waits Dormant until its first booking; a PT package starts on its first
 * session request rather than a class.
 */
function dormantLine(pkg: LivePackage): string {
  const start = pkg.kind === "pt" ? "Starts at your first session request" : ACTIVATION_LINE;
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
  const api = useApi();
  const {
    classCredits,
    isUnlimited: unlimited,
    unlimitedExpiresAt,
    unlimitedDormant,
    pt1on1,
    pt2on1,
    packages: livePackages,
    crossLocation,
    loading: pkgLoading,
  } = useClientPackages();
  const { data: locations } = useLocations();
  // A balance the member left outstanding (#93). It sits above the packages
  // because it is the one thing on this page waiting on them.
  const { purchases: openPurchases, failed: openPurchasesFailed } = useOpenPurchases();
  const partPayment = usePartPaymentOptions();
  const ptSessionsRemaining = pt1on1 + pt2on1;
  const firstName = user?.firstName || "there";
  const [nextUpVisible, setNextUpVisible] = useState(PAGE_SIZE);

  const [upcoming, setUpcoming] = useState<ApiBooking[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  // The booking the ticket at the top already shows, so the list below
  // doesn't repeat it.
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const onFeatured = useCallback((id: string | null) => setFeaturedId(id), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUpcomingLoading(true);
      try {
        const res = await api.get<{ bookings: ApiBooking[] }>("/me/bookings/upcoming");
        if (!cancelled) setUpcoming(res.bookings ?? []);
      } catch (err) {
        reportError(err, { scope: "upcoming-bookings" });
        if (!cancelled) setUpcoming([]);
      } finally {
        if (!cancelled) setUpcomingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const comingUp = upcoming.filter((b) => b.booking_id !== featuredId);
  const packages = livePackages.filter(
    (p) => p.kind === "credit_bundle" || p.kind === "unlimited" || p.kind === "pt",
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
          {/* The class running now or next, with its check-in QR one tap away (#192). */}
          <MyNextClass onResolved={onFeatured} />

          {/* Balances — side by side even on a phone; they're read together. */}
          <div className="xl:hidden mb-6">
            <Balances
              loading={pkgLoading}
              unlimited={unlimited}
              classCredits={classCredits}
              unlimitedExpiresAt={unlimitedExpiresAt}
              unlimitedDormant={unlimitedDormant}
              ptSessions={ptSessionsRemaining}
            />
          </div>

          {/* Unfinished purchases — money paid that has granted nothing yet. */}
          <div className="[&>*:first-child]:mt-0 mb-6 empty:hidden">
            <OpenPurchases
              purchases={openPurchases}
              partPayment={partPayment}
              failed={openPurchasesFailed}
            />
          </div>

          <section aria-labelledby="coming-up" className="mb-8">
            <SectionTitle action={upcoming.length > 0 ? { href: "/account/classes", label: "All classes" } : undefined}>
              <span id="coming-up">Coming up</span>
            </SectionTitle>
            {upcomingLoading ? (
              <ContentLoading label="Loading upcoming classes" className="min-h-48" />
            ) : comingUp.length === 0 ? (
              <div className={cn(cardClass, "p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between")}>
                <div>
                  <p className="font-semibold text-ink">
                    {upcoming.length === 0 ? "No classes booked" : "Nothing else booked yet"}
                  </p>
                  <p className="text-sm text-muted mt-0.5">Pick a class from the schedule to hold your spot.</p>
                </div>
                <Link
                  href="/"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-ink/10 px-5 min-h-[44px] text-sm font-semibold text-ink hover:border-accent hover:text-accent-deep transition-colors"
                >
                  See the schedule
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <div className={cn(cardClass, "divide-y divide-ink/5")}>
                {comingUp.slice(0, nextUpVisible).map((b) => (
                  <div key={b.booking_id} className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4">
                    <DateStub iso={b.starts_at} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink truncate">{b.name}</p>
                      <p className="text-sm text-muted truncate">
                        {formatClassTime(b.starts_at)}
                        {b.instructor ? ` · ${b.instructor.name}` : ""}
                      </p>
                      {b.location && (
                        <p className="text-xs text-muted truncate">{b.location.name}</p>
                      )}
                    </div>
                    <QrBadge
                      value={b.qr_token}
                      label={b.name}
                      subLabel={`${formatDate(b.starts_at)} · ${b.code}`}
                    />
                  </div>
                ))}
                {comingUp.length > nextUpVisible && (
                  <button
                    type="button"
                    onClick={() => setNextUpVisible((v) => v + PAGE_SIZE)}
                    className="w-full min-h-[48px] text-sm font-semibold text-accent-deep hover:bg-ink/[0.02] rounded-b-2xl transition-colors"
                  >
                    Show more
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0">
          <div className="hidden xl:block mb-8">
            <SectionTitle>Balance</SectionTitle>
            <Balances
              loading={pkgLoading}
              unlimited={unlimited}
              classCredits={classCredits}
              unlimitedExpiresAt={unlimitedExpiresAt}
              unlimitedDormant={unlimitedDormant}
              ptSessions={ptSessionsRemaining}
            />
          </div>

          <section aria-labelledby="packages-heading" className="mb-8">
            <SectionTitle action={{ href: "/packages", label: "Buy more" }}>
              <span id="packages-heading">Active packages</span>
            </SectionTitle>
            {pkgLoading ? (
              <ContentLoading label="Loading your packages" className="min-h-24" />
            ) : packages.length === 0 ? (
              <div className={cn(cardClass, "p-5")}>
                <p className="font-semibold text-ink">No active packages</p>
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

function Balances({
  loading,
  unlimited,
  classCredits,
  unlimitedExpiresAt,
  unlimitedDormant,
  ptSessions,
}: {
  loading: boolean;
  unlimited: boolean;
  classCredits: number;
  unlimitedExpiresAt: string | null;
  unlimitedDormant: boolean;
  ptSessions: number;
}) {
  const classNote = unlimited
    ? unlimitedExpiresAt
      ? `Until ${formatExpiryDate(unlimitedExpiresAt)}`
      : unlimitedDormant
        ? ACTIVATION_LINE
        : null
    : null;
  return (
    <div className="grid grid-cols-2 gap-3">
      <BalanceTile
        icon={Ticket}
        label="Class credits"
        value={loading ? "—" : unlimited ? "Unlimited" : String(classCredits)}
        note={classNote}
        compactValue={unlimited}
      />
      <BalanceTile
        icon={UserRound}
        label="PT sessions"
        value={loading ? "—" : String(ptSessions)}
      />
    </div>
  );
}

function BalanceTile({
  icon: Icon,
  label,
  value,
  note,
  compactValue = false,
}: {
  icon: typeof Ticket;
  label: string;
  value: string;
  note?: string | null;
  compactValue?: boolean;
}) {
  return (
    <div className={cn(cardClass, "p-4 sm:p-5 min-w-0")}>
      <div className="flex items-center gap-2 text-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent-deep">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-semibold truncate">{label}</span>
      </div>
      <p
        className={cn(
          "mt-3 font-extrabold text-ink tabular-nums leading-none truncate",
          compactValue ? "text-2xl" : "text-3xl sm:text-4xl",
        )}
      >
        {value}
      </p>
      {note && <p className="text-xs text-muted mt-1.5 line-clamp-2">{note}</p>}
    </div>
  );
}

/**
 * The account's sections as a menu, for phones and tablets where there is no
 * sidebar. It closes the overview rather than opening it: what the member came
 * to see — the next class, the balance — comes first.
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
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              isPt ? "bg-cyan/15 text-cyan-deep" : "bg-accent/10 text-accent-deep",
            )}
          >
            {isPt ? "Private" : isUnlimited ? "Unlimited" : "Classes"}
          </span>
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
          {/* What this plan Covers, and when cross-location coverage ends —
              losing it is never silent (§5). */}
          {isUnlimited && pkg.location && (
            <p className="text-xs text-muted mt-1">
              {pkg.crossLocationPaidSgd !== null ? (
                pkg.expiresAt ? (
                  <>
                    Both studios until {formatExpiryDate(pkg.expiresAt)}, then{" "}
                    <span className="text-ink">{pkg.location.name}</span> only.
                  </>
                ) : (
                  <>Both studios, for the length of this plan.</>
                )
              ) : (
                <>
                  <span className="text-ink">{pkg.location.name}</span> only.
                </>
              )}
            </p>
          )}
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
