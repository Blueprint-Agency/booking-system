"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import type { ClientPackage, Product } from "@/types";
import packagesData from "@/data/client-packages.json";
import productsData from "@/data/products.json";

const CLIENT_ID = "cli-1";

const packages = packagesData as ClientPackage[];
const products = productsData as Product[];

function getProduct(id: string) {
  return products.find((p) => p.id === id);
}

function getCreditType(pkg: ClientPackage): "class" | "pt" {
  return getProduct(pkg.productId)?.creditType ?? "class";
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function ProgressRing({
  remaining,
  total,
  expired,
  color,
}: {
  remaining: number;
  total: number;
  expired: boolean;
  color: "sage" | "accent";
}) {
  const size = 80;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? remaining / total : 0;
  const offset = circumference * (1 - ratio);

  const strokeColor = expired
    ? "var(--color-muted)"
    : color === "sage"
      ? "var(--color-sage)"
      : "var(--color-accent)";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            "text-lg font-semibold leading-none",
            expired ? "text-muted" : "text-ink"
          )}
        >
          {remaining}
        </span>
        <span className="text-[10px] text-muted leading-tight">left</span>
      </div>
    </div>
  );
}

function PackageCard({
  pkg,
  expired,
  animIndex,
}: {
  pkg: ClientPackage;
  expired: boolean;
  animIndex: number;
}) {
  const product = getProduct(pkg.productId);
  const creditType = getCreditType(pkg);
  const isPt = creditType === "pt";
  const creditLabel = isPt ? "PT credits" : "class credits";

  return (
    <motion.div
      key={pkg.id}
      initial="hidden"
      animate="visible"
      custom={animIndex}
      variants={fadeUp}
      className={cn(
        "bg-card border rounded-xl p-5 flex items-center gap-5",
        expired ? "border-border opacity-50" : isPt ? "border-accent/20" : "border-border"
      )}
    >
      <ProgressRing
        remaining={pkg.sessionsRemaining}
        total={pkg.sessionsTotal}
        expired={expired}
        color={isPt ? "accent" : "sage"}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h3 className={cn("font-serif text-lg", expired ? "text-muted" : "text-ink")}>
            {product?.name ?? "Package"}
          </h3>
          <span className={cn(
            "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border",
            isPt
              ? "bg-accent-glow/30 text-accent-deep border-accent/20"
              : "bg-sage-light text-sage border-sage/20"
          )}>
            {isPt ? "PT" : "Class"}
          </span>
          {expired && <StatusBadge status="expired" />}
        </div>
        <p className={cn("text-sm mb-1", expired ? "text-muted" : "text-muted")}>
          {pkg.sessionsRemaining} of {pkg.sessionsTotal} {creditLabel} remaining
        </p>
        {pkg.expiresAt && (
          <p className="text-xs text-muted">
            {expired ? "Expired" : "Expires"} {formatDate(pkg.expiresAt)}
          </p>
        )}
        <p className="text-xs text-muted">
          Purchased {formatDate(pkg.purchasedAt)}
        </p>
      </div>
    </motion.div>
  );
}

export default function MyPackages() {
  const myPackages = packages.filter((p) => p.clientId === CLIENT_ID);
  const activePackages = myPackages.filter((p) => p.status === "active");
  const expiredPackages = myPackages.filter((p) => p.status === "expired");

  // Split active by credit type for summary
  const activeClassPkgs = activePackages.filter((p) => getCreditType(p) === "class");
  const activePtPkgs = activePackages.filter((p) => getCreditType(p) === "pt");
  const totalClassCredits = activeClassPkgs.reduce((sum, p) => sum + p.sessionsRemaining, 0);
  const totalClassMax = activeClassPkgs.reduce((sum, p) => sum + p.sessionsTotal, 0);
  const totalPtCredits = activePtPkgs.reduce((sum, p) => sum + p.sessionsRemaining, 0);
  const totalPtMax = activePtPkgs.reduce((sum, p) => sum + p.sessionsTotal, 0);

  // Earliest expiry for each type
  const classExpiry = activeClassPkgs
    .filter((p) => p.expiresAt)
    .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))[0]?.expiresAt;
  const ptExpiry = activePtPkgs
    .filter((p) => p.expiresAt)
    .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))[0]?.expiresAt;

  if (myPackages.length === 0) {
    return (
      <EmptyState
        icon="📦"
        title="No packages yet"
        description="Purchase a class pack or PT package to get started."
        actionLabel="Browse Packages"
        actionHref="/packages"
      />
    );
  }

  return (
    <div>
      <motion.h2
        initial="hidden"
        animate="visible"
        custom={0}
        variants={fadeUp}
        className="font-serif text-xl text-ink mb-6"
      >
        My Packages
      </motion.h2>

      {/* ── Credit summary dashboard ─────────────────────── */}
      <motion.div
        initial="hidden"
        animate="visible"
        custom={0.5}
        variants={fadeUp}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8"
      >
        {/* Class credits summary */}
        <div className="bg-sage-light/40 border border-sage/15 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-sage" />
            <span className="text-sm font-medium text-ink">Class Credits</span>
          </div>
          {totalClassCredits > 0 ? (
            <>
              <p className="text-3xl font-semibold text-ink mb-1">{totalClassCredits}</p>
              <div className="w-full h-2 rounded-full bg-sage/20 overflow-hidden mb-2">
                <div
                  className="h-full rounded-full bg-sage transition-all duration-700"
                  style={{ width: `${totalClassMax > 0 ? (totalClassCredits / totalClassMax) * 100 : 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted">
                  {totalClassCredits} of {totalClassMax} remaining
                </p>
                {classExpiry && (
                  <p className="text-xs text-muted">
                    Soonest expiry: {formatDate(classExpiry)}
                  </p>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-sage/15">
                <Link
                  href="/classes"
                  className="text-xs font-medium text-sage hover:text-sage/80 transition-colors"
                >
                  Book a class →
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted mb-3">No active class credits</p>
              <Link
                href="/packages"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-sage hover:text-sage/80 transition-colors"
              >
                Buy class credits →
              </Link>
            </>
          )}
        </div>

        {/* PT credits summary */}
        <div className="bg-accent-glow/20 border border-accent/15 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-deep" />
            <span className="text-sm font-medium text-ink">PT Credits</span>
          </div>
          {totalPtCredits > 0 ? (
            <>
              <p className="text-3xl font-semibold text-ink mb-1">{totalPtCredits}</p>
              <div className="w-full h-2 rounded-full bg-accent/20 overflow-hidden mb-2">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-700"
                  style={{ width: `${totalPtMax > 0 ? (totalPtCredits / totalPtMax) * 100 : 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted">
                  {totalPtCredits} of {totalPtMax} remaining
                </p>
                {ptExpiry && (
                  <p className="text-xs text-muted">
                    Soonest expiry: {formatDate(ptExpiry)}
                  </p>
                )}
              </div>
              <p className="text-[10px] text-muted mt-1.5">1 credit = 30 mins of personal training</p>
              <div className="mt-3 pt-3 border-t border-accent/15">
                <Link
                  href="/private-sessions"
                  className="text-xs font-medium text-accent-deep hover:text-accent transition-colors"
                >
                  Book a session →
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted mb-3">No active PT credits</p>
              <Link
                href="/packages"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-deep hover:text-accent transition-colors"
              >
                Buy PT package →
              </Link>
            </>
          )}
        </div>
      </motion.div>

      {/* ── Active packages ──────────────────────────────── */}
      {activePackages.length > 0 && (
        <>
          <motion.h3
            initial="hidden"
            animate="visible"
            custom={1}
            variants={fadeUp}
            className="text-sm font-medium text-ink uppercase tracking-wide mb-3"
          >
            Active Packages
          </motion.h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {activePackages.map((pkg, i) => (
              <PackageCard key={pkg.id} pkg={pkg} expired={false} animIndex={2 + i} />
            ))}
          </div>
        </>
      )}

      {/* ── Expired packages ─────────────────────────────── */}
      {expiredPackages.length > 0 && (
        <>
          <motion.h3
            initial="hidden"
            animate="visible"
            custom={activePackages.length + 3}
            variants={fadeUp}
            className="text-sm font-medium text-muted uppercase tracking-wide mb-3"
          >
            Expired
          </motion.h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {expiredPackages.map((pkg, i) => (
              <PackageCard key={pkg.id} pkg={pkg} expired animIndex={activePackages.length + 4 + i} />
            ))}
          </div>
        </>
      )}

      {/* ── Buy more CTA ─────────────────────────────────── */}
      <motion.div
        initial="hidden"
        animate="visible"
        custom={myPackages.length + 4}
        variants={fadeUp}
        className="text-center py-4"
      >
        <Link
          href="/packages"
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-white text-sm font-medium rounded-md hover:bg-accent-deep transition-colors duration-200"
        >
          Browse More Packages
        </Link>
      </motion.div>
    </div>
  );
}
