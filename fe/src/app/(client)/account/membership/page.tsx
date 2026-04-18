"use client";

import { Crown, Check } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/booking/section-heading";
import type { Membership, Product } from "@/types";
import membershipsData from "@/data/memberships.json";
import productsData from "@/data/products.json";

const CLIENT_ID = "cli-1";

const memberships = membershipsData as Membership[];
const products = productsData as Product[];

export default function MembershipPage() {
  const membership = memberships.find((m) => m.clientId === CLIENT_ID);
  const product = membership ? products.find((p) => p.id === membership.productId) : null;

  if (!membership || !product) {
    return (
      <EmptyState
        icon={Crown}
        title="No active membership"
        description="Purchase a package to get started with your yoga practice."
        cta={{ href: "/packages", label: "View Packages" }}
      />
    );
  }

  const alternatePlans = products
    .filter((p) => p.id !== product.id && (p.type === "membership" || p.type === "package"))
    .slice(0, 4);

  const defaultBenefits = [
    "Access to all classes",
    "Book up to 14 days in advance",
    "Cancel anytime",
  ];

  return (
    <div>
      <SectionHeading eyebrow="Membership" title="Your plan" />

      <div className="rounded-3xl bg-ink text-paper p-10 shadow-soft">
        <Crown className="h-8 w-8 text-paper/80 mb-6" strokeWidth={1.5} />
        <h3 className="text-3xl font-extrabold">{product.name}</h3>
        <p className="text-base text-paper/70 mt-2">{product.description}</p>
        <p className="text-sm text-paper/60 mt-6">
          Renews on {formatDate(membership.nextBillingDate)} · {formatCurrency(product.price)}
          {product.type === "membership" ? "/month" : ""}
        </p>
        <a
          href="https://wa.me/6591234567?text=Hi%20Yoga%20Sadhana%2C%20I%27d%20like%20to%20discuss%20my%20membership."
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center min-h-[44px] rounded-full bg-paper text-ink px-5 py-3 text-sm font-medium mt-6 hover:bg-paper/90 transition-colors"
        >
          Contact Sales Team
        </a>
      </div>

      {alternatePlans.length > 0 && (
        <div className="mt-12">
          <SectionHeading eyebrow="Upgrade" title="Other plans" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {alternatePlans.map((plan) => (
              <div
                key={plan.id}
                className="rounded-2xl bg-paper border border-ink/10 p-8"
              >
                <h4 className="text-lg font-semibold text-ink">{plan.name}</h4>
                <p className="text-2xl font-bold text-ink mt-2">
                  {formatCurrency(plan.price)}
                  {plan.type === "membership" ? (
                    <span className="text-sm font-medium text-muted">/month</span>
                  ) : null}
                </p>
                <ul className="mt-5 space-y-2">
                  {defaultBenefits.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-muted">
                      <Check className="h-4 w-4 text-accent-deep mt-0.5 shrink-0" strokeWidth={2} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="w-full rounded-full border border-ink/10 py-3 text-sm font-medium hover:border-accent transition-colors mt-6"
                >
                  Switch to this plan
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
