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

const FEATURES = [
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
    title: "Easy Booking",
    description:
      "Browse sessions, pick a time, and book in seconds. No phone calls, no friction.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: "Real-Time Availability",
    description:
      "See live class capacity and waitlist status. Never wonder if a spot is open.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
        <path d="M17 21l5-5" />
        <path d="M17 16v5h5" />
        <rect x="7" y="8" width="4" height="4" rx="1" />
      </svg>
    ),
    title: "Flexible Packages",
    description:
      "Drop-in, class packs, or unlimited passes. Choose what fits your routine.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
        <path d="M9 8h6M9 12h4" />
      </svg>
    ),
    title: "Mobile Check-In",
    description:
      "Show your QR code at the door. Fast, contactless, and paper-free.",
  },
];

const PRICING = [
  {
    name: "Drop-in",
    price: "$25",
    per: "/ session",
    description: "Perfect for trying things out or a single visit.",
    features: ["Single session access", "Book any class", "No commitment"],
    highlighted: false,
  },
  {
    name: "Starter Pack",
    price: "$90",
    per: "/ 5 sessions",
    description: "The most popular choice for regulars building a routine.",
    features: [
      "5 session credits",
      "Valid for 60 days",
      "Book any class",
      "Save 28%",
    ],
    highlighted: true,
  },
  {
    name: "Unlimited",
    price: "$149",
    per: "/ month",
    description: "All-access for the dedicated practitioner.",
    features: [
      "Unlimited sessions",
      "Priority booking",
      "Free guest pass / month",
      "Best value",
    ],
    highlighted: false,
  },
];

const FOOTER_LINKS = [
  { label: "Sessions", href: "/sessions" },
  { label: "Pricing", href: "/pricing" },
  { label: "Login", href: "/login" },
  { label: "Register", href: "/register" },
];

export default function LandingPage() {
  return (
    <div className="overflow-hidden">
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative py-20 sm:py-28 lg:py-36 px-6 sm:px-8">
        {/* Decorative blobs */}
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
            Booking made simple
          </motion.p>

          <motion.h1
            initial="hidden"
            animate="visible"
            custom={1}
            variants={fadeUp}
            className="font-serif text-3xl sm:text-5xl lg:text-6xl text-ink leading-[1.1] mb-6"
          >
            Book with ease.
            <br />
            Grow with confidence.
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={2}
            variants={fadeUp}
            className="max-w-2xl mx-auto text-base sm:text-lg text-muted leading-relaxed mb-10"
          >
            The modern booking platform for class-based businesses. Manage
            schedules, sell packages, and delight your clients — all in one
            place.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            custom={3}
            variants={fadeUp}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              href="/sessions"
              className="w-full sm:w-auto px-8 py-3.5 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
            >
              Browse Sessions
            </Link>
            <Link
              href="/register"
              className="w-full sm:w-auto px-8 py-3.5 text-sm font-semibold text-accent-deep border-2 border-accent-glow rounded-md hover:bg-accent-glow/20 transition-all duration-300"
            >
              Get Started
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
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
              Everything you need
            </h2>
            <p className="text-muted text-base sm:text-lg max-w-xl mx-auto">
              A seamless experience from discovery to check-in, for both clients
              and studios.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
                className="group bg-card border border-border rounded-xl p-6 shadow-soft hover:shadow-hover transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-12 h-12 rounded-md bg-accent-glow/40 text-accent-deep flex items-center justify-center mb-5 group-hover:bg-accent group-hover:text-white transition-colors duration-300">
                  {feature.icon}
                </div>
                <h3 className="font-serif text-lg text-ink mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted leading-relaxed">
                  {feature.description}
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
              No hidden fees. Pick the plan that matches how often you practice.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-start">
            {PRICING.map((plan, i) => (
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
                  href="/register"
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
            Ready to simplify your bookings?
          </h2>
          <p className="text-muted text-base sm:text-lg mb-8 max-w-xl mx-auto">
            Join studios and practitioners who use Booked4U to fill classes and
            grow their community.
          </p>
          <Link
            href="/register"
            className="inline-block px-10 py-4 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
          >
            Create Your Free Account
          </Link>
        </motion.div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-border py-10 px-6 sm:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-white font-bold text-xs">T</span>
            </div>
            <span className="font-serif text-lg text-ink">Booked4U</span>
          </div>

          <nav className="flex items-center gap-6">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted hover:text-ink transition-colors duration-200"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <p className="text-xs text-muted">
            &copy; {new Date().getFullYear()} Booked4U. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
