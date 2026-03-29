"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import tenants from "@/data/tenants.json";

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const STUDENT_STEPS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    title: "Browse",
    description: "Explore classes, workshops, and experiences across studios and creators near you.",
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
    title: "Book",
    description: "Pick a session, choose your time, and reserve your spot in seconds.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    title: "Show up",
    description: "Check in with your QR code and enjoy. No paper, no fuss.",
  },
];

const BUSINESS_STEPS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    ),
    title: "Sign up",
    description: "Create your business account in minutes. No credit card required to start.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: "Get listed",
    description: "Add your sessions and go live on the marketplace. Customers find you instantly.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    title: "Grow",
    description: "Reach new customers, manage bookings, and scale your business with data.",
  },
];

const CATEGORIES = [
  { emoji: "\ud83d\udcaa", name: "Fitness", slug: "Fitness" },
  { emoji: "\ud83c\udfa8", name: "Arts & Crafts", slug: "Arts & Crafts" },
  { emoji: "\ud83d\udc68\u200d\ud83c\udf73", name: "Cooking", slug: "Cooking" },
  { emoji: "\ud83c\udfb5", name: "Music", slug: "Music" },
  { emoji: "\ud83e\udde0", name: "Wellness", slug: "Wellness" },
  { emoji: "\ud83d\udcbb", name: "Education", slug: "Education" },
];

const FOOTER_LINKS = [
  { label: "Explore", href: "/explore" },
  { label: "For Business", href: "/for-business" },
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
            Your marketplace for experiences
          </motion.p>

          <motion.h1
            initial="hidden"
            animate="visible"
            custom={1}
            variants={fadeUp}
            className="font-serif text-3xl sm:text-5xl lg:text-6xl text-ink leading-[1.1] mb-6"
          >
            Discover classes, workshops
            <br />
            &amp; experiences.
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={2}
            variants={fadeUp}
            className="max-w-2xl mx-auto text-base sm:text-lg text-muted leading-relaxed mb-10"
          >
            Book across studios and creators — all in one place.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            custom={3}
            variants={fadeUp}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              href="/explore"
              className="w-full sm:w-auto px-8 py-3.5 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
            >
              Explore Classes
            </Link>
            <Link
              href="/for-business"
              className="w-full sm:w-auto px-8 py-3.5 text-sm font-semibold text-accent-deep border-2 border-accent-glow rounded-md hover:bg-accent-glow/20 transition-all duration-300"
            >
              List Your Business
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Featured Tenants ───────────────────────────────── */}
      <section className="py-16 sm:py-24 px-6 sm:px-8 bg-warm">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="text-center mb-12"
          >
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-4">
              Popular on Booked4U
            </h2>
            <p className="text-muted text-base sm:text-lg max-w-xl mx-auto">
              Studios and creators people love booking with.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tenants.map((tenant, i) => (
              <motion.div
                key={tenant.id}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
              >
                <Link
                  href={`/explore/${tenant.slug}`}
                  className="block bg-card border border-border rounded-xl p-6 shadow-soft hover:shadow-hover transition-all duration-300 hover:-translate-y-1"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-accent-glow/30 flex items-center justify-center text-2xl shrink-0">
                      {tenant.logoEmoji}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-serif text-lg text-ink mb-1 truncate">
                        {tenant.name}
                      </h3>
                      <span className="inline-block px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-accent-deep bg-accent-glow/30 rounded-full mb-2">
                        {tenant.industry}
                      </span>
                      <p className="text-sm text-muted leading-relaxed line-clamp-2">
                        {tenant.shortDescription}
                      </p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works — Students ────────────────────────── */}
      <section className="py-16 sm:py-24 px-6 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="text-center mb-14"
          >
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-4">
              How it works — Students
            </h2>
            <p className="text-muted text-base sm:text-lg max-w-xl mx-auto">
              Finding and booking your next class is effortless.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STUDENT_STEPS.map((step, i) => (
              <motion.div
                key={step.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-2xl bg-accent-glow/40 text-accent-deep flex items-center justify-center mx-auto mb-5">
                  {step.icon}
                </div>
                <h3 className="font-serif text-xl text-ink mb-2">{step.title}</h3>
                <p className="text-sm text-muted leading-relaxed max-w-xs mx-auto">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works — Businesses ──────────────────────── */}
      <section className="py-16 sm:py-24 px-6 sm:px-8 bg-warm">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="text-center mb-14"
          >
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-4">
              How it works — Businesses
            </h2>
            <p className="text-muted text-base sm:text-lg max-w-xl mx-auto">
              Get your studio or workshop in front of more customers.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {BUSINESS_STEPS.map((step, i) => (
              <motion.div
                key={step.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-2xl bg-sage-light/60 text-sage flex items-center justify-center mx-auto mb-5">
                  {step.icon}
                </div>
                <h3 className="font-serif text-xl text-ink mb-2">{step.title}</h3>
                <p className="text-sm text-muted leading-relaxed max-w-xs mx-auto">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Industry Categories ─────────────────────────────── */}
      <section className="py-16 sm:py-24 px-6 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="text-center mb-14"
          >
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-4">
              Explore by category
            </h2>
            <p className="text-muted text-base sm:text-lg max-w-xl mx-auto">
              Whatever you're into, there's something for you.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {CATEGORIES.map((cat, i) => (
              <motion.div
                key={cat.name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
              >
                <Link
                  href={`/explore?industry=${encodeURIComponent(cat.slug)}`}
                  className="flex flex-col items-center gap-3 bg-card border border-border rounded-xl p-5 shadow-soft hover:shadow-hover transition-all duration-300 hover:-translate-y-1"
                >
                  <span className="text-3xl">{cat.emoji}</span>
                  <span className="text-sm font-medium text-ink">{cat.name}</span>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Business CTA Banner ─────────────────────────────── */}
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
            Run a studio or workshop?
          </h2>
          <p className="text-muted text-base sm:text-lg mb-8 max-w-xl mx-auto">
            Reach more customers with Booked4U. List your business, manage bookings, and grow your community.
          </p>
          <Link
            href="/for-business"
            className="inline-block px-10 py-4 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
          >
            Learn More
          </Link>
        </motion.div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-border py-10 px-6 sm:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-white font-bold text-xs">B</span>
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
