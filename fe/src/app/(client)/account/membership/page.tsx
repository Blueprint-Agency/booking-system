"use client";

import { motion } from "framer-motion";
import { formatDate, formatCurrency } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import type { Membership, Product } from "@/types";
import membershipsData from "@/data/memberships.json";
import productsData from "@/data/products.json";

const CLIENT_ID = "cli-1";
const WHATSAPP_NUMBER = "6591234567";
const MOCK_TODAY = new Date("2026-04-03T10:00:00");

// Package duration in days — used to filter applicable reminder milestones
const PACKAGE_DURATION_DAYS: Record<string, number> = {
  "prod-1": 1,    // one-time pass
  "prod-2": 1,
  "prod-3": 30,
  "prod-4": 60,
  "prod-5": 90,
  "prod-6": 30,   // monthly membership
  "prod-7": 30,   // unlimited monthly
};

const REMINDER_MILESTONES = [
  { hours: 2,   label: "2 hours",  urgency: "critical" as const },
  { hours: 12,  label: "12 hours", urgency: "critical" as const },
  { hours: 24,  label: "1 day",    urgency: "critical" as const },
  { hours: 168, label: "7 days",   urgency: "high" as const },
  { hours: 360, label: "15 days",  urgency: "medium" as const },
  { hours: 720, label: "30 days",  urgency: "low" as const },
];

function getExpiryBanner(expiryDateStr: string, packageDurationDays: number) {
  const expiry = new Date(expiryDateStr + "T00:00:00");
  const diffMs = expiry.getTime() - MOCK_TODAY.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours <= 0) return null;

  // Find innermost applicable milestone
  for (const m of REMINDER_MILESTONES) {
    const milestoneDays = m.hours / 24;
    if (diffHours <= m.hours && milestoneDays <= packageDurationDays) {
      return { urgency: m.urgency, daysLeft: diffDays, expiryDate: formatDate(expiryDateStr) };
    }
  }
  return null;
}

const memberships = membershipsData as Membership[];
const products = productsData as Product[];

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function ExpiryBanner({ daysLeft, expiryDate, urgency }: { daysLeft: number; expiryDate: string; urgency: string }) {
  const isCritical = urgency === "critical";
  const isHigh = urgency === "high";
  const classes = isCritical
    ? "bg-error-bg border-error/30 text-error"
    : isHigh
    ? "bg-warning-bg border-warning/30 text-warning"
    : "bg-info-bg border-info/30 text-info";
  const iconColor = isCritical ? "text-error" : isHigh ? "text-warning" : "text-info";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`flex items-start gap-3 border rounded-lg px-4 py-3.5 mb-6 ${classes}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 mt-0.5 ${iconColor}`}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="flex-1">
        <p className="text-sm font-medium">
          Your package expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""} ({expiryDate})
        </p>
        <p className="text-xs mt-0.5 opacity-80">
          Renew your package or contact our sales team to continue your practice uninterrupted.
        </p>
      </div>
      <a
        href={`https://wa.me/${WHATSAPP_NUMBER}?text=Hi%2C%20I%20would%20like%20to%20renew%20my%20Yoga%20Sadhana%20package.`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 px-3 py-1.5 text-xs font-medium bg-white/60 rounded-md hover:bg-white/80 transition-colors border border-current/20"
      >
        Renew now
      </a>
    </motion.div>
  );
}

export default function MembershipPage() {
  const membership = memberships.find((m) => m.clientId === CLIENT_ID);
  const product = membership ? products.find((p) => p.id === membership.productId) : null;

  if (!membership || !product) {
    return (
      <EmptyState
        icon="⭐"
        title="No active membership"
        description="Purchase a package to get started with your yoga practice."
        actionLabel="View Packages"
        actionHref="/packages"
      />
    );
  }

  const packageDuration = PACKAGE_DURATION_DAYS[membership.productId] ?? 30;
  const expiryBanner = getExpiryBanner(membership.nextBillingDate, packageDuration);

  return (
    <div>
      <motion.h2 initial="hidden" animate="visible" custom={0} variants={fadeUp} className="font-serif text-xl text-ink mb-6">
        Membership
      </motion.h2>

      {/* Expiry reminder banner */}
      {expiryBanner && (
        <ExpiryBanner
          daysLeft={expiryBanner.daysLeft}
          expiryDate={expiryBanner.expiryDate}
          urgency={expiryBanner.urgency}
        />
      )}

      <motion.div initial="hidden" animate="visible" custom={1} variants={fadeUp} className="bg-card border border-border rounded-lg p-6 sm:p-8 max-w-lg">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h3 className="font-serif text-2xl text-ink mb-1">{product.name}</h3>
            <p className="text-sm text-muted">{product.description}</p>
          </div>
          <StatusBadge status={membership.status} />
        </div>

        {/* Details */}
        <div className="space-y-0 mb-8 divide-y divide-border">
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-muted">Monthly price</span>
            <span className="text-sm font-medium text-ink">{formatCurrency(product.price)}/month</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-muted">Next billing date</span>
            <span className="text-sm font-medium text-ink">{formatDate(membership.nextBillingDate)}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-muted">Sessions this month</span>
            <span className="text-sm font-medium text-ink">
              {membership.sessionsUsedThisMonth}
              {membership.sessionsPerMonth ? ` / ${membership.sessionsPerMonth}` : " (Unlimited)"}
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-muted">Member since</span>
            <span className="text-sm font-medium text-ink">{formatDate(membership.startedAt)}</span>
          </div>
        </div>

        {/* Contact Sales CTA (replaces Cancel) */}
        <div className="space-y-3">
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=Hi%2C%20I%20have%20a%20question%20about%20my%20Yoga%20Sadhana%20membership.`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2.5 w-full px-5 py-3 text-sm font-medium text-white bg-sage rounded-md hover:bg-sage/90 transition-colors"
          >
            {/* WhatsApp icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Contact Sales Team
          </a>
          <p className="text-xs text-muted text-center">
            Want to change or cancel your plan? Our team is happy to help.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
