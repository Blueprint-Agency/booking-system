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

const OFFERINGS = [
  {
    href: "/classes",
    label: "Classes",
    description: "Group yoga sessions across all levels — book with your credits.",
    color: "bg-accent-glow/30 text-accent-deep border-accent/20 hover:bg-accent-glow/50 hover:border-accent/40",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h7" />
      </svg>
    ),
  },
  {
    href: "/workshops",
    label: "Workshops",
    description: "Specialised deep-dives and community events with limited spots.",
    color: "bg-sage-light text-sage border-sage/20 hover:bg-sage-light hover:border-sage/40",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: "/private-sessions",
    label: "Private Sessions",
    description: "1-on-1 or 2-on-1 personal training with our instructors.",
    color: "bg-warning-bg text-warning border-warning/20 hover:bg-warning-bg hover:border-warning/40",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    href: "/packages",
    label: "Packages",
    description: "Credit bundles, unlimited access, and VIP private session plans.",
    color: "bg-info-bg text-info border-info/20 hover:bg-info-bg hover:border-info/40",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
];

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Pick a class",
    description: "Browse the weekly schedule and find a session that fits your day.",
    color: "bg-accent-glow/40 text-accent-deep",
  },
  {
    step: "2",
    title: "Reserve your spot",
    description: "Use your credits to book instantly. No payment at the door.",
    color: "bg-sage-light text-sage",
  },
  {
    step: "3",
    title: "Show up & practise",
    description: "Arrive 15 minutes early, scan your QR code, and step onto the mat.",
    color: "bg-warning-bg text-warning",
  },
];

export default function HomePage() {
  return (
    <div className="overflow-hidden">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative py-24 sm:py-36 px-6 sm:px-8">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-[500px] h-[500px] rounded-full bg-accent-glow/20 blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full bg-sage-light/40 blur-3xl" />
        </div>

        <div className="relative max-w-3xl mx-auto text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            custom={0}
            variants={fadeUp}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-glow/30 border border-accent/20 text-accent-deep text-xs font-medium mb-6"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent-deep" />
            Tiong Bahru, Singapore
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            custom={1}
            variants={fadeUp}
            className="font-serif text-4xl sm:text-5xl lg:text-6xl text-ink leading-[1.1] mb-5"
          >
            Find stillness.
            <br />
            Build strength.
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={2}
            variants={fadeUp}
            className="text-base sm:text-lg text-muted mb-10 max-w-xl mx-auto leading-relaxed"
          >
            Traditional yoga classes, specialised workshops, and private training — all in one place.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            custom={3}
            variants={fadeUp}
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Link
              href="/classes"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-accent text-white font-medium rounded-lg hover:bg-accent-deep transition-colors duration-200 text-base"
            >
              Browse Classes
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link
              href="/account"
              className="inline-flex items-center gap-2 px-6 py-3.5 text-muted font-medium rounded-lg border border-border hover:text-ink hover:border-ink/30 transition-colors duration-200 text-base"
            >
              My Bookings
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── What we offer ─────────────────────────────────── */}
      <section className="py-14 sm:py-20 px-6 sm:px-8 bg-warm">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="mb-8"
          >
            <h2 className="font-serif text-2xl sm:text-3xl text-ink mb-2">What we offer</h2>
            <p className="text-sm text-muted">Everything you need for a consistent practice.</p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {OFFERINGS.map((item, i) => (
              <motion.div
                key={item.href}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-40px" }}
                custom={i + 1}
                variants={fadeUp}
              >
                <Link
                  href={item.href}
                  className={`flex flex-col gap-4 p-6 rounded-xl border transition-all duration-200 hover:shadow-soft hover:-translate-y-0.5 h-full ${item.color}`}
                >
                  <div className="w-12 h-12 rounded-xl bg-white/40 flex items-center justify-center">
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="font-serif text-lg mb-1.5">{item.label}</h3>
                    <p className="text-sm opacity-80 leading-relaxed">{item.description}</p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Instructors teaser ─────────────────────────────── */}
      <section className="py-14 sm:py-20 px-6 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="flex items-center justify-between mb-8"
          >
            <div>
              <h2 className="font-serif text-2xl sm:text-3xl text-ink mb-2">Our instructors</h2>
              <p className="text-sm text-muted">Trained practitioners dedicated to your growth.</p>
            </div>
            <Link
              href="/private-sessions"
              className="text-sm text-accent-deep hover:underline transition-colors duration-200 hidden sm:block"
            >
              Book private session →
            </Link>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
            {[
              { name: "Master Sumit", role: "Head Instructor · Hatha & Ashtanga", avatar: "https://placehold.co/200x200/f5f0e8/c4956a?text=MS&font=playfair-display" },
              { name: "Ananya Patel", role: "Vinyasa & Yin", avatar: "https://placehold.co/200x200/e8ede6/7a8f72?text=AP&font=playfair-display" },
              { name: "Priya Nair",   role: "Restorative & Pranayama", avatar: "https://placehold.co/200x200/eef4fb/5a8ac4?text=PN&font=playfair-display" },
              { name: "Ravi Kumar",  role: "Power Yoga & Ashtanga", avatar: "https://placehold.co/200x200/faf3e0/d4a843?text=RK&font=playfair-display" },
            ].map((inst, i) => (
              <motion.div
                key={inst.name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-40px" }}
                custom={i + 1}
                variants={fadeUp}
                className="flex flex-col items-center text-center gap-3"
              >
                <img
                  src={inst.avatar}
                  alt={inst.name}
                  className="w-20 h-20 rounded-full object-cover border-2 border-border shadow-soft"
                />
                <div>
                  <p className="font-serif text-base text-ink">{inst.name}</p>
                  <p className="text-xs text-muted mt-0.5 leading-snug">{inst.role}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How to book ───────────────────────────────────── */}
      <section className="py-14 sm:py-20 px-6 sm:px-8 bg-warm">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            custom={0}
            variants={fadeUp}
            className="text-center mb-12"
          >
            <h2 className="font-serif text-2xl sm:text-3xl text-ink mb-3">How to book</h2>
            <p className="text-muted text-sm sm:text-base max-w-md mx-auto">
              Three steps. No friction.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <motion.div
                key={step.step}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                custom={i + 1}
                variants={fadeUp}
                className="text-center"
              >
                <div className={`w-14 h-14 rounded-2xl ${step.color} flex items-center justify-center mx-auto mb-5`}>
                  <span className="font-serif text-2xl font-semibold">{step.step}</span>
                </div>
                <h3 className="font-serif text-xl text-ink mb-2">{step.title}</h3>
                <p className="text-sm text-muted leading-relaxed max-w-xs mx-auto">{step.description}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            custom={4}
            variants={fadeUp}
            className="text-center mt-12"
          >
            <Link
              href="/packages"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors"
            >
              View packages & pricing
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-border py-10 px-6 sm:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-white font-bold text-xs">Y</span>
            </div>
            <span className="font-serif text-lg text-ink">Yoga Sadhana</span>
          </div>

          <nav className="flex items-center gap-6 flex-wrap justify-center">
            <Link href="/classes"          className="text-sm text-muted hover:text-ink transition-colors">Classes</Link>
            <Link href="/workshops"         className="text-sm text-muted hover:text-ink transition-colors">Workshops</Link>
            <Link href="/private-sessions"  className="text-sm text-muted hover:text-ink transition-colors">Private Sessions</Link>
            <Link href="/packages"          className="text-sm text-muted hover:text-ink transition-colors">Packages</Link>
            <Link href="/account"           className="text-sm text-muted hover:text-ink transition-colors">My Bookings</Link>
          </nav>

          <p className="text-xs text-muted">&copy; {new Date().getFullYear()} Yoga Sadhana. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
