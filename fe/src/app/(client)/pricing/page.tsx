"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import products from "@/data/products.json";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { key: "drop-in", label: "Drop-in", description: "Pay per session, no commitment" },
  { key: "package", label: "Packages", description: "Bundle sessions and save" },
  { key: "membership", label: "Memberships", description: "Unlimited access monthly" },
] as const;

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="py-16 sm:py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="font-serif text-4xl sm:text-5xl text-ink mb-4"
          >
            Simple, transparent pricing
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-muted text-lg max-w-xl mx-auto"
          >
            Choose the plan that fits your schedule. Start with a single session or commit to unlimited access.
          </motion.p>
        </div>
      </section>

      {/* Pricing sections */}
      {CATEGORIES.map((cat, catIdx) => {
        const items = products.filter((p) => p.type === cat.key);
        return (
          <section key={cat.key} className="pb-16 px-4">
            <div className="max-w-5xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: catIdx * 0.15 }}
                className="mb-8"
              >
                <h2 className="font-serif text-2xl text-ink mb-1">{cat.label}</h2>
                <p className="text-muted text-sm">{cat.description}</p>
              </motion.div>

              <div className={cn(
                "grid gap-5",
                items.length === 1 ? "max-w-md" : items.length === 2 ? "grid-cols-1 sm:grid-cols-2 max-w-2xl" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              )}>
                {items.map((product, idx) => {
                  const isPopular = product.id === "prod-4"; // Standard Pack
                  return (
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: catIdx * 0.15 + idx * 0.08 }}
                      className={cn(
                        "relative bg-card border rounded-lg p-6 flex flex-col transition-all duration-300 hover:shadow-hover hover:-translate-y-1",
                        isPopular
                          ? "border-accent shadow-hover ring-1 ring-accent/20"
                          : "border-border shadow-soft"
                      )}
                    >
                      {isPopular && (
                        <span className="absolute -top-3 left-6 bg-accent text-white text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-full">
                          Most Popular
                        </span>
                      )}
                      <h3 className="font-serif text-xl text-ink mb-1">{product.name}</h3>
                      <div className="flex items-baseline gap-1 mb-3">
                        <span className="text-3xl font-semibold text-ink">{formatCurrency(product.price)}</span>
                        {product.type === "membership" && (
                          <span className="text-sm text-muted">/month</span>
                        )}
                        {product.type === "drop-in" && (
                          <span className="text-sm text-muted">/session</span>
                        )}
                      </div>
                      <p className="text-sm text-muted mb-5 flex-1">{product.description}</p>
                      <ul className="text-sm text-ink space-y-2 mb-6">
                        {product.type === "package" && product.sessionCount && (
                          <>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              {product.sessionCount} sessions included
                            </li>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              Valid for {product.expiryDays} days
                            </li>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              {formatCurrency(product.price / product.sessionCount)}/session
                            </li>
                          </>
                        )}
                        {product.type === "membership" && (
                          <>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              {product.sessionsPerMonth ? `${product.sessionsPerMonth} sessions/month` : "Unlimited sessions"}
                            </li>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              Cancel anytime
                            </li>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              Auto-renewal monthly
                            </li>
                          </>
                        )}
                        {product.type === "drop-in" && (
                          <>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              No commitment
                            </li>
                            <li className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                              Pay as you go
                            </li>
                          </>
                        )}
                      </ul>
                      <Link
                        href="/checkout"
                        className={cn(
                          "block text-center py-2.5 px-4 rounded-md text-sm font-medium transition-colors duration-200",
                          isPopular
                            ? "bg-accent text-white hover:bg-accent-deep"
                            : "bg-warm text-ink hover:bg-accent-glow"
                        )}
                      >
                        {product.type === "membership" ? "Subscribe" : "Purchase"}
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      {/* FAQ-style note */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-serif text-2xl text-ink mb-4">Questions?</h2>
          <p className="text-muted text-sm leading-relaxed">
            All packages include access to regular sessions. Workshop and event sessions may require separate purchase.
            Memberships auto-renew monthly and can be cancelled anytime from your account settings.
            Package credits expire on the date shown and cannot be transferred.
          </p>
        </div>
      </section>
    </div>
  );
}
