"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/booking/section-heading";
import type { Booking, ClientPackage, Product, Session } from "@/types";
import packagesData from "@/data/client-packages.json";
import productsData from "@/data/products.json";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";

const CLIENT_ID = "cli-1";

const packages = packagesData as ClientPackage[];
const products = productsData as Product[];
const bookings = bookingsData as Booking[];
const sessions = sessionsData as Session[];

function getProduct(id: string) {
  return products.find((p) => p.id === id);
}

function getHistory(pkgId: string) {
  return bookings
    .filter((b) => b.packageId === pkgId && b.clientId === CLIENT_ID)
    .map((b) => {
      const s = sessions.find((x) => x.id === b.sessionId);
      return { id: b.id, date: s?.date ?? b.createdAt, label: s?.name ?? "Session" };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function PackageCard({ pkg }: { pkg: ClientPackage }) {
  const [open, setOpen] = useState(false);
  const product = getProduct(pkg.productId);
  const expired = pkg.status === "expired";
  const used = Math.max(0, pkg.sessionsTotal - pkg.sessionsRemaining);
  const pct = pkg.sessionsTotal > 0 ? (used / pkg.sessionsTotal) * 100 : 0;
  const history = getHistory(pkg.id);

  return (
    <div>
      <div
        className={`rounded-2xl bg-paper border border-ink/10 p-6 flex flex-col relative ${
          expired ? "opacity-60" : ""
        }`}
      >
        {expired && (
          <span className="absolute top-4 right-4 bg-error/10 text-error rounded-full px-3 py-1 text-xs font-medium">
            Expired
          </span>
        )}
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="text-lg font-bold text-ink">{product?.name ?? "Package"}</h3>
          {!expired && pkg.expiresAt && (
            <span className="rounded-full bg-warm px-3 py-1 text-xs text-muted whitespace-nowrap">
              Expires {formatDate(pkg.expiresAt)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-4xl font-extrabold text-ink">{pkg.sessionsRemaining}</span>
          <span className="text-sm text-muted">credits remaining</span>
        </div>
        <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
          <span className="bg-accent h-full block" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-xs text-muted">
          {used} of {pkg.sessionsTotal} used · purchased {formatDate(pkg.purchasedAt)}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-ink/10 px-4 py-2 text-xs font-medium hover:border-accent self-start mt-6"
        >
          {open ? "Hide history" : "View history"}
        </button>
      </div>
      {open && (
        <div className="mt-3 rounded-2xl bg-warm border border-ink/10 p-4 text-sm">
          {history.length === 0 ? (
            <p className="text-muted">No usage recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink">{h.label}</span>
                  <span className="text-muted text-xs">{formatDate(h.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyPackages() {
  const myPackages = packages.filter((p) => p.clientId === CLIENT_ID);

  if (myPackages.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No packages yet"
        description="Purchase a class pack or PT package to get started."
        cta={{ href: "/packages", label: "Browse Packages" }}
      />
    );
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Packages"
        title="Your credits"
        description="Track balances and usage across all your packages."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {myPackages.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} />
        ))}
      </div>
    </div>
  );
}
