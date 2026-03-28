"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { formatDate, formatCurrency } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import type { Membership, Product } from "@/types";
import membershipsData from "@/data/memberships.json";
import productsData from "@/data/products.json";

const CLIENT_ID = "cli-1";

const memberships = membershipsData as Membership[];
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

export default function MembershipPage() {
  const [showCancel, setShowCancel] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);

  const membership = memberships.find((m) => m.clientId === CLIENT_ID);
  const product = membership ? getProduct(membership.productId) : null;

  if (!membership || !product) {
    return (
      <EmptyState
        icon="⭐"
        title="No active membership"
        description="Upgrade to a membership for unlimited access and monthly billing."
        actionLabel="View Plans"
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
        Membership
      </motion.h2>

      <motion.div
        initial="hidden"
        animate="visible"
        custom={1}
        variants={fadeUp}
        className="bg-card border border-border rounded-lg p-6 sm:p-8 max-w-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h3 className="font-serif text-2xl text-ink mb-1">
              {product.name}
            </h3>
            <p className="text-sm text-muted">{product.description}</p>
          </div>
          <StatusBadge status={isCancelled ? "cancelled" : membership.status} />
        </div>

        {/* Details */}
        <div className="space-y-4 mb-8">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <span className="text-sm text-muted">Monthly price</span>
            <span className="text-sm font-medium text-ink">
              {formatCurrency(product.price)}/month
            </span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <span className="text-sm text-muted">Next billing date</span>
            <span className="text-sm font-medium text-ink">
              {formatDate(membership.nextBillingDate)}
            </span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <span className="text-sm text-muted">Sessions this month</span>
            <span className="text-sm font-medium text-ink">
              {membership.sessionsUsedThisMonth}
              {membership.sessionsPerMonth
                ? ` / ${membership.sessionsPerMonth}`
                : " (Unlimited)"}
            </span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <span className="text-sm text-muted">Member since</span>
            <span className="text-sm font-medium text-ink">
              {formatDate(membership.startedAt)}
            </span>
          </div>
        </div>

        {/* Cancel button */}
        {!isCancelled && (
          <button
            onClick={() => setShowCancel(true)}
            className="px-5 py-2.5 text-sm font-medium text-error border border-error/30 rounded-md hover:bg-error-bg transition-colors duration-200"
          >
            Cancel Membership
          </button>
        )}

        {isCancelled && (
          <div className="bg-error-bg border border-error/20 rounded-md p-4">
            <p className="text-sm text-error font-medium">
              Membership cancelled
            </p>
            <p className="text-xs text-error/70 mt-1">
              Your access continues until{" "}
              {formatDate(membership.nextBillingDate)}.
            </p>
          </div>
        )}
      </motion.div>

      {/* Cancel Confirmation Dialog */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-in">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="bg-card rounded-xl shadow-modal p-8 max-w-sm w-full mx-4"
          >
            <h3 className="font-serif text-xl text-ink mb-2">
              Cancel Membership?
            </h3>
            <p className="text-sm text-muted mb-4">
              If you cancel your membership:
            </p>
            <ul className="space-y-2 mb-6">
              <li className="flex items-start gap-2 text-sm text-muted">
                <span className="text-error mt-0.5 shrink-0">&bull;</span>
                You will lose access to unlimited sessions after your current
                billing period ends on{" "}
                {formatDate(membership.nextBillingDate)}.
              </li>
              <li className="flex items-start gap-2 text-sm text-muted">
                <span className="text-error mt-0.5 shrink-0">&bull;</span>
                Any existing bookings after that date will be automatically
                cancelled.
              </li>
              <li className="flex items-start gap-2 text-sm text-muted">
                <span className="text-error mt-0.5 shrink-0">&bull;</span>
                You can re-subscribe at any time, but promotional rates may no
                longer apply.
              </li>
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancel(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-muted border border-border rounded-md hover:bg-warm transition-colors duration-200"
              >
                Keep Membership
              </button>
              <button
                onClick={() => {
                  setIsCancelled(true);
                  setShowCancel(false);
                }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-error rounded-md hover:bg-error/90 transition-colors duration-200"
              >
                Yes, Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
