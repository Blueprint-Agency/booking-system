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
}: {
  remaining: number;
  total: number;
  expired: boolean;
}) {
  const size = 80;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? remaining / total : 0;
  const offset = circumference * (1 - ratio);

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
          stroke={expired ? "var(--color-muted)" : "var(--color-sage)"}
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

export default function MyPackages() {
  const myPackages = packages.filter((p) => p.clientId === CLIENT_ID);
  const activePackages = myPackages.filter((p) => p.status === "active");
  const expiredPackages = myPackages.filter((p) => p.status === "expired");

  if (myPackages.length === 0) {
    return (
      <EmptyState
        icon="📦"
        title="No packages yet"
        description="Purchase a class pack to save on sessions and track your progress."
        actionLabel="Browse Packages"
        actionHref="/pricing"
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

      {/* Active packages */}
      {activePackages.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {activePackages.map((pkg, i) => {
            const product = getProduct(pkg.productId);
            return (
              <motion.div
                key={pkg.id}
                initial="hidden"
                animate="visible"
                custom={1 + i}
                variants={fadeUp}
                className="bg-card border border-border rounded-lg p-6 flex items-center gap-5"
              >
                <ProgressRing
                  remaining={pkg.sessionsRemaining}
                  total={pkg.sessionsTotal}
                  expired={false}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-lg text-ink mb-1">
                    {product?.name ?? "Package"}
                  </h3>
                  <p className="text-sm text-muted mb-1">
                    {pkg.sessionsRemaining} of {pkg.sessionsTotal} sessions
                    remaining
                  </p>
                  {pkg.expiresAt && (
                    <p className="text-xs text-muted">
                      Expires {formatDate(pkg.expiresAt)}
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    Purchased {formatDate(pkg.purchasedAt)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Expired packages */}
      {expiredPackages.length > 0 && (
        <>
          <motion.h3
            initial="hidden"
            animate="visible"
            custom={activePackages.length + 2}
            variants={fadeUp}
            className="text-sm font-medium text-muted uppercase tracking-wide mb-3"
          >
            Expired
          </motion.h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {expiredPackages.map((pkg, i) => {
              const product = getProduct(pkg.productId);
              return (
                <motion.div
                  key={pkg.id}
                  initial="hidden"
                  animate="visible"
                  custom={activePackages.length + 3 + i}
                  variants={fadeUp}
                  className="bg-card border border-border rounded-lg p-6 flex items-center gap-5 opacity-50"
                >
                  <ProgressRing
                    remaining={pkg.sessionsRemaining}
                    total={pkg.sessionsTotal}
                    expired
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-serif text-lg text-muted">
                        {product?.name ?? "Package"}
                      </h3>
                      <StatusBadge status="expired" />
                    </div>
                    <p className="text-sm text-muted">
                      {pkg.sessionsRemaining} of {pkg.sessionsTotal} sessions
                      remaining
                    </p>
                    {pkg.expiresAt && (
                      <p className="text-xs text-muted">
                        Expired {formatDate(pkg.expiresAt)}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      {/* Browse CTA if no active */}
      {activePackages.length === 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          custom={myPackages.length + 2}
          variants={fadeUp}
          className="text-center py-8"
        >
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-white text-sm font-medium rounded-md hover:bg-accent-deep transition-colors duration-200"
          >
            Browse Packages
          </Link>
        </motion.div>
      )}
    </div>
  );
}
