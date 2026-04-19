"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import products from "@/data/products.json";
import { formatCurrency, cn } from "@/lib/utils";
import { CLASS_CANCELLATION_POLICY } from "@/data/policy";

const CATEGORIES = [
  { key: "drop-in",    eyebrow: "Try it",    label: "Drop-in",     description: "Pay per session — no commitment, no package required." },
  { key: "package",    eyebrow: "Save more", label: "Packages",    description: "Bundle credits and lock in lower per-session pricing." },
  { key: "membership", eyebrow: "Unlimited", label: "Memberships", description: "Practice as often as you like with one monthly fee." },
] as const;

const FAQS = [
  { q: "Do credits expire?", a: "Bundle credits expire on the date shown when you purchase. Unused credits are forfeited at expiry — no rollover." },
  { q: "Can I share my membership?", a: "VIP private session packages are family-shareable for 1-on-1 and 2-on-1 sessions. Other plans are personal." },
  { q: "How do cancellations work?", a: CLASS_CANCELLATION_POLICY.faqShort },
  { q: "Are workshops included in packages?", a: "Workshops require separate purchase. Packages cover regular group sessions only." },
  { q: "How does auto-renewal work?", a: "Memberships auto-renew monthly. You can cancel anytime from your account settings." },
];

function PricingCard({ product, isPopular, delay }: {
  product: typeof products[number];
  isPopular: boolean;
  delay: number;
}) {
  const ctaLabel =
    product.type === "drop-in" ? "Book a class" :
    product.type === "membership" ? "Subscribe" :
    "Buy now";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative bg-card border rounded-lg p-6 flex flex-col transition-all hover:-translate-y-1",
        isPopular
          ? "border-accent ring-1 ring-accent/20 shadow-hover"
          : "border-border shadow-soft hover:shadow-hover"
      )}
    >
      {isPopular && (
        <span className="absolute -top-3 left-6 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-inverse bg-accent rounded-full">
          Most popular
        </span>
      )}
      <h3 className="text-[20px] font-bold text-ink mb-3">{product.name}</h3>
      <div className="flex items-baseline gap-1.5 mb-4">
        <span className="text-[36px] font-extrabold text-ink leading-none tracking-tight">{formatCurrency(product.price)}</span>
        {product.type === "membership" && <span className="text-[14px] text-muted">/month</span>}
        {product.type === "drop-in" && <span className="text-[14px] text-muted">/class</span>}
      </div>
      <ul className="space-y-2 my-6 text-[14px] text-muted flex-1">
        {product.type === "drop-in" && (
          <>
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> Single session, any class</li>
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> No package commitment</li>
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> Pay at booking</li>
          </>
        )}
        {product.type === "package" && (
          <>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> {(product as any).sessionCount} sessions included</li>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> Valid for {(product as any).expiryDays} days</li>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> {formatCurrency(product.price / (product as any).sessionCount)}/session</li>
          </>
        )}
        {product.type === "membership" && (
          <>
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> Unlimited group classes</li>
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> Auto-renews monthly</li>
            <li className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sage mt-2 shrink-0" /> Cancel anytime from your account</li>
          </>
        )}
      </ul>
      <Link
        href="/classes"
        className={cn(
          "inline-flex items-center justify-center w-full px-5 py-3 text-[14px] font-bold rounded-md transition-colors duration-200 mt-auto",
          isPopular
            ? "text-inverse bg-accent hover:bg-accent-deep"
            : "text-ink border border-ink/15 hover:border-ink/30"
        )}
      >
        {ctaLabel}
      </Link>
    </motion.div>
  );
}

export default function PricingPage() {
  return (
    <div>
<section id="packages" className="py-20 sm:py-28">
        <div className="max-w-[1280px] mx-auto px-6 sm:px-8 space-y-20">
          {CATEGORIES.map((cat, catIdx) => {
            const items = products.filter((p) => p.type === cat.key);
            if (items.length === 0) return null;
            return (
              <div key={cat.key}>
                <div className="mb-12">
                  <p className="text-[12px] font-bold uppercase tracking-wider text-accent-deep mb-4">{cat.eyebrow}</p>
                  <h2 className="text-[32px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight text-ink mb-3">{cat.label}</h2>
                  <p className="text-[17px] leading-relaxed text-muted max-w-[60ch]">{cat.description}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {items.map((product, idx) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const isPopular = (product as any).popular === true || ((product as any).popular === undefined && idx === 1 && items.length >= 2);
                    return (
                      <PricingCard
                        key={product.id}
                        product={product}
                        isPopular={isPopular}
                        delay={catIdx * 0.15 + idx * 0.08}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="py-20 sm:py-28 bg-warm">
        <div className="max-w-[800px] mx-auto px-6 sm:px-8">
          <h2 className="text-[32px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight text-ink mb-12 text-center">
            Common questions
          </h2>
          <div className="space-y-8">
            {FAQS.map((faq) => (
              <div key={faq.q}>
                <h3 className="text-[18px] font-bold text-ink mb-2">{faq.q}</h3>
                <p className="text-[15px] leading-relaxed text-muted">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
