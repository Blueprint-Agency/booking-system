"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Ticket,
  UserRound,
  CalendarX,
  Package,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { QrBadge } from "@/components/account/qr-badge";
import { useUser } from "@clerk/nextjs";
import { useApi } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import { useClientPackages, type LivePackage } from "@/lib/use-client-packages";
import type { ApiBooking } from "@/components/account/class-bookings";

const PAGE_SIZE = 5;

export default function AccountOverview() {
  const { user } = useUser();
  const api = useApi();
  const {
    classCredits,
    isUnlimited: unlimited,
    unlimitedExpiresAt,
    pt1on1,
    pt2on1,
    packages: livePackages,
    loading: pkgLoading,
  } = useClientPackages();
  const ptSessionsRemaining = pt1on1 + pt2on1;
  const firstName = user?.firstName || "there";
  const [nextUpVisible, setNextUpVisible] = useState(PAGE_SIZE);

  const [upcoming, setUpcoming] = useState<ApiBooking[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

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

  const classPackages = livePackages.filter(
    (p) => p.kind === "credit_bundle" || p.kind === "unlimited",
  );
  const ptPackages = livePackages.filter((p) => p.kind === "pt");

  return (
    <div>
      <SectionHeading
        eyebrow={`Welcome back, ${firstName}`}
        title="Here's your practice"
      />

      {/* Credit totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <Ticket className="w-5 h-5 text-accent-deep mb-3" />
          <p className="text-3xl font-extrabold text-ink">
            {pkgLoading ? "—" : unlimited ? "Unlimited" : classCredits}
          </p>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            Class credits
          </p>
          {unlimited && unlimitedExpiresAt && (
            <p className="text-xs text-muted mt-1">
              Valid until {formatDate(unlimitedExpiresAt)}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <UserRound className="w-5 h-5 text-accent-deep mb-3" />
          <p className="text-3xl font-extrabold text-ink">
            {pkgLoading ? "—" : ptSessionsRemaining}
          </p>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            PT sessions
          </p>
        </div>
      </div>

      {/* Next up — upcoming classes (live) */}
      <div className="mt-6 rounded-2xl bg-paper border border-ink/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Next up
          </h3>
          {upcoming.length > 0 && (
            <Link href="/account/classes" className="text-xs font-medium text-accent-deep hover:underline">
              View all
            </Link>
          )}
        </div>
        {upcomingLoading ? (
          <div className="space-y-3 py-2" aria-label="Loading upcoming classes">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarX}
            title="No upcoming classes"
            description="Browse classes to book your next session."
            cta={{ href: "/classes", label: "Browse classes" }}
          />
        ) : (
          <div>
            {upcoming.slice(0, nextUpVisible).map((b) => (
              <Link
                key={b.booking_id}
                href="/account/classes"
                className="flex items-center justify-between gap-4 py-3 border-b border-ink/5 last:border-0 hover:opacity-80 transition-opacity"
              >
                <div className="min-w-0">
                  <span className="inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-accent/15 text-accent-deep">
                    Class
                  </span>
                  <p className="font-medium text-ink truncate mt-1">{b.name}</p>
                  {b.instructor && (
                    <p className="text-sm text-muted mt-0.5">with {b.instructor.name}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm text-ink">{formatDate(b.starts_at)}</p>
                  <p className="text-sm text-muted">{formatClassTime(b.starts_at)}</p>
                </div>
                <QrBadge
                  value={b.qr_token}
                  label={b.name}
                  subLabel={`${formatDate(b.starts_at)} · ${b.code}`}
                />
              </Link>
            ))}
            {upcoming.length > nextUpVisible && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setNextUpVisible((v) => v + PAGE_SIZE);
                  }}
                  className="rounded-full border border-ink/10 px-5 py-2 text-sm font-medium hover:border-accent transition-colors"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Packages — Class */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Class packages
        </h3>
        {classPackages.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No active class packages"
            description="Purchase a bundle or unlimited pass to start booking classes."
            cta={{ href: "/packages", label: "Browse packages" }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {classPackages.map((p) => (
              <PackageCard key={p.id} pkg={p} unitLabel="credits" />
            ))}
          </div>
        )}
      </div>

      {/* Packages — PT */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          PT packages
        </h3>
        {ptPackages.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No active PT packages"
            description="Purchase a 1-on-1 or 2-on-1 package to book private sessions."
            cta={{ href: "/packages", label: "Browse packages" }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ptPackages.map((p) => (
              <PackageCard key={p.id} pkg={p} unitLabel="sessions" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PackageCard({
  pkg,
  unitLabel,
}: {
  pkg: LivePackage;
  unitLabel: string;
}) {
  const isUnlimited = pkg.kind === "unlimited";
  return (
    <div className="rounded-2xl bg-paper border border-ink/10 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{pkg.name}</p>
          <p className="text-xs text-muted mt-1">
            {pkg.expiresAt ? `Expires ${formatDate(pkg.expiresAt)}` : "No expiry"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-extrabold text-ink">
            {isUnlimited ? "∞" : pkg.creditsOrSessionsRemaining}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted">
            {isUnlimited ? "Unlimited" : unitLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
