"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const BENEFITS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    title: "Marketplace Visibility",
    description:
      "Get discovered by thousands of customers actively searching for classes and experiences in your area.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
    title: "Booking Management",
    description:
      "Real-time scheduling, automatic waitlists, and instant confirmations. No more spreadsheets or phone tag.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
        <path d="M7 15h2M12 15h4" />
      </svg>
    ),
    title: "Payments & Packages",
    description:
      "Accept payments online, sell drop-ins, class packs, and subscriptions. Get paid directly to your account.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    title: "Business Analytics",
    description:
      "Track attendance, revenue, popular sessions, and customer retention with clear dashboards and reports.",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "$29",
    per: "/ month",
    description: "Perfect for new studios just getting started.",
    features: [
      "Up to 5 sessions",
      "1 admin account",
      "Basic analytics",
      "Email support",
      "Marketplace listing",
    ],
    highlighted: false,
  },
  {
    name: "Growth",
    price: "$79",
    per: "/ month",
    description: "For established studios ready to scale.",
    features: [
      "Unlimited sessions",
      "3 staff accounts",
      "Full analytics dashboard",
      "Priority support",
      "Featured listing",
      "Custom packages",
    ],
    highlighted: true,
  },
  {
    name: "Professional",
    price: "$149",
    per: "/ month",
    description: "Everything you need to run a premium operation.",
    features: [
      "Unlimited everything",
      "Unlimited staff",
      "Advanced analytics & exports",
      "Custom branding",
      "API access",
      "Dedicated account manager",
    ],
    highlighted: false,
  },
];

export default function ForBusinessPage() {
  return (
    <div className="overflow-hidden">
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative py-20 sm:py-28 lg:py-36 px-6 sm:px-8">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-[500px] h-[500px] rounded-full bg-accent-glow/20 blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full bg-sage-light/40 blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <motion.p
            initial="hidden"
            animate="visible"
            custom={0}
            variants={fadeUp}
            className="inline-block mb-6 px-4 py-1.5 text-xs font-mono uppercase tracking-widest text-accent-deep bg-accent-glow/30 rounded-full"
          >
            For businesses
          </motion.p>

          <motion.h1
            initial="hidden"
            animate="visible"
            custom={1}
            variants={fadeUp}
            className="font-serif text-3xl sm:text-5xl lg:text-6xl text-ink leading-[1.1] mb-6"
          >
            Grow your business
            <br />
            with Booked4U.
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={2}
            variants={fadeUp}
            className="max-w-2xl mx-auto text-base sm:text-lg text-muted leading-relaxed mb-10"
          >
            The modern booking platform that helps studios, workshops, and experience creators
            reach more customers and manage everything in one place.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            custom={3}
            variants={fadeUp}
          >
            <Link
              href="/for-business/register"
              className="inline-block px-8 py-3.5 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
            >
              Get Started
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Benefits ────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-6 sm:px-8 bg-warm">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="text-center mb-16"
          >
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-4">
              Everything your business needs
            </h2>
            <p className="text-muted text-base sm:text-lg max-w-xl mx-auto">
              Tools built for class-based businesses, from solo instructors to multi-location studios.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {BENEFITS.map((benefit, i) => (
              <motion.div
                key={benefit.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
                className="group bg-card border border-border rounded-xl p-6 shadow-soft hover:shadow-hover transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-12 h-12 rounded-md bg-accent-glow/40 text-accent-deep flex items-center justify-center mb-5 group-hover:bg-accent group-hover:text-white transition-colors duration-300">
                  {benefit.icon}
                </div>
                <h3 className="font-serif text-lg text-ink mb-2">
                  {benefit.title}
                </h3>
                <p className="text-sm text-muted leading-relaxed">
                  {benefit.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-6 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="text-center mb-16"
          >
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-4">
              Simple, transparent pricing
            </h2>
            <p className="text-muted text-base sm:text-lg max-w-xl mx-auto">
              Choose the plan that fits your business. Upgrade or downgrade anytime.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-start">
            {PLANS.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
                className={`relative rounded-xl p-8 transition-all duration-300 ${
                  plan.highlighted
                    ? "bg-ink text-white shadow-hover md:scale-[1.03] ring-2 ring-accent"
                    : "bg-card border border-border shadow-soft hover:shadow-hover"
                }`}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider bg-accent text-white rounded-full">
                    Most Popular
                  </span>
                )}
                <h3
                  className={`font-serif text-xl mb-1 ${
                    plan.highlighted ? "text-white" : "text-ink"
                  }`}
                >
                  {plan.name}
                </h3>
                <p
                  className={`text-sm mb-6 ${
                    plan.highlighted ? "text-white/60" : "text-muted"
                  }`}
                >
                  {plan.description}
                </p>
                <div className="flex items-baseline gap-1 mb-8">
                  <span
                    className={`text-4xl font-serif ${
                      plan.highlighted ? "text-accent-glow" : "text-ink"
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span
                    className={`text-sm ${
                      plan.highlighted ? "text-white/50" : "text-muted"
                    }`}
                  >
                    {plan.per}
                  </span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        className={`shrink-0 ${
                          plan.highlighted ? "text-accent-glow" : "text-sage"
                        }`}
                      >
                        <path
                          d="M3.5 8.5L6.5 11.5L12.5 4.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span
                        className={
                          plan.highlighted ? "text-white/80" : "text-muted"
                        }
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/for-business/register"
                  className={`block w-full text-center py-3 text-sm font-semibold rounded-md transition-all duration-300 ${
                    plan.highlighted
                      ? "bg-accent text-white hover:bg-accent-deep"
                      : "border-2 border-accent-glow text-accent-deep hover:bg-accent-glow/20"
                  }`}
                >
                  Get Started
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ──────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-6 sm:px-8 bg-warm">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          custom={0}
          variants={fadeUp}
          className="max-w-3xl mx-auto text-center"
        >
          <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-4">
            Ready to get started?
          </h2>
          <p className="text-muted text-base sm:text-lg mb-8 max-w-xl mx-auto">
            Join hundreds of studios and creators growing their business with Booked4U.
          </p>
          <Link
            href="/for-business/register"
            className="inline-block px-10 py-4 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
          >
            Create Your Business Account
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
