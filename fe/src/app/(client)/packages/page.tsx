"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

type BundleItem = {
  id: string;
  name: string;
  credits: string;
  price: number;
  tag: string;
  highlight?: boolean;
  pending?: boolean;
};

type UnlimitedItem = {
  id: string;
  name: string;
  duration: string;
  price: number;
  highlight?: boolean;
};

type PrivateItem = {
  id: string;
  name: string;
  sessions: number;
  credits?: number;
  creditRate?: number;
  price: number;
  type: "1on1" | "2on1";
};

const BUNDLES: BundleItem[] = [
  { id: "b-otp", name: "One-time Pass", credits: "1 credit", price: 40, tag: "1 day" },
  { id: "b-10",  name: "Bundle of 10",  credits: "10 credits", price: 300, tag: "90 days" },
  { id: "b-20",  name: "Bundle of 20",  credits: "20 credits", price: 550, tag: "180 days", highlight: true },
  { id: "b-30",  name: "Bundle of 30",  credits: "30 credits", price: 750, tag: "365 days" },
  { id: "b-50",  name: "Bundle of 50",  credits: "50 credits", price: 1100, tag: "365 days" },
  { id: "b-100", name: "Bundle of 100", credits: "100 credits", price: 2000, tag: "365 days" },
  { id: "b-travel", name: "Travel Package", credits: "5 credits", price: 60, tag: "30 days", pending: true },
];

const UNLIMITED: UnlimitedItem[] = [
  { id: "u-3",  name: "3-Month Unlimited",  duration: "3 months",  price: 600 },
  { id: "u-6",  name: "6-Month Unlimited",  duration: "6 months",  price: 1000, highlight: true },
  { id: "u-12", name: "12-Month Unlimited", duration: "12 months", price: 1700 },
];

const PRIVATE_1ON1: PrivateItem[] = [
  { id: "p1-10",  name: "VIP 10",  sessions: 10,  credits: 20,  creditRate: 80, price: 1600,  type: "1on1" },
  { id: "p1-20",  name: "VIP 20",  sessions: 20,  credits: 40,  creditRate: 75, price: 3000,  type: "1on1" },
  { id: "p1-30",  name: "VIP 30",  sessions: 30,  credits: 60,  creditRate: 70, price: 4200,  type: "1on1" },
  { id: "p1-40",  name: "VIP 40",  sessions: 40,  credits: 80,  creditRate: 65, price: 5200,  type: "1on1" },
  { id: "p1-50",  name: "VIP 50",  sessions: 50,  credits: 100, creditRate: 60, price: 6000,  type: "1on1" },
  { id: "p1-100", name: "VIP 100", sessions: 100, credits: 200, creditRate: 55, price: 11000, type: "1on1" },
];

const PRIVATE_2ON1: PrivateItem[] = [
  { id: "p2-10", name: "VIP 10 Sessions", sessions: 10, price: 2000, type: "2on1" },
  { id: "p2-20", name: "VIP 20 Sessions", sessions: 20, price: 3600, type: "2on1" },
  { id: "p2-30", name: "VIP 30 Sessions", sessions: 30, price: 4800, type: "2on1" },
  { id: "p2-50", name: "VIP 50 Sessions", sessions: 50, price: 7500, type: "2on1" },
];

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 bg-info-bg border border-info/20 rounded-md px-4 py-3 text-sm text-info">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-serif text-2xl text-ink mb-1">{title}</h2>
      <p className="text-sm text-muted">{subtitle}</p>
    </div>
  );
}

export default function PackagesPage() {
  const [activeTab, setActiveTab] = useState<"bundle" | "unlimited">("bundle");

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-16">
      {/* Page heading */}
      <motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-2">Packages</h1>
        <p className="text-muted text-base max-w-xl">
          Choose a plan that fits your practice. Group class credits for classes; PT credits for personal training. Both can be held at the same time.
        </p>
      </motion.div>

      {/* ── Section 1: Class Credits ──────────────────────── */}
      <motion.section initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}>
        <SectionHeader
          title="Class Credits"
          subtitle="Use credits to book any group class. 1 credit = 1 class attendance."
        />

        {/* Toggle: Bundle / Unlimited */}
        <div className="inline-flex rounded-lg border border-border bg-warm p-1 mb-8">
          <button
            onClick={() => setActiveTab("bundle")}
            className={cn(
              "px-5 py-2 text-sm font-medium rounded-md transition-all duration-200",
              activeTab === "bundle" ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
            )}
          >
            Credit Bundles
          </button>
          <button
            onClick={() => setActiveTab("unlimited")}
            className={cn(
              "px-5 py-2 text-sm font-medium rounded-md transition-all duration-200",
              activeTab === "unlimited" ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
            )}
          >
            Unlimited Access
          </button>
        </div>

        <InfoNote>
          Credit bundles and unlimited access cannot be purchased at the same time. You may combine either with private session packages.
        </InfoNote>

        {/* Bundle cards */}
        {activeTab === "bundle" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
            {BUNDLES.map((item, i) => (
              <motion.div key={item.id} custom={i + 1} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                <div className={cn(
                  "relative bg-card border rounded-xl p-5 flex flex-col gap-4 h-full",
                  item.highlight ? "border-accent shadow-hover" : "border-border",
                  item.pending && "opacity-75"
                )}>
                  {item.highlight && (
                    <span className="absolute -top-2.5 left-4 text-[10px] font-mono uppercase tracking-wider bg-accent text-white px-2.5 py-0.5 rounded-full">
                      Most popular
                    </span>
                  )}
                  {item.pending && (
                    <span className="absolute -top-2.5 right-4 text-[10px] font-mono uppercase tracking-wider bg-warning-bg text-warning border border-warning/20 px-2.5 py-0.5 rounded-full">
                      Coming soon
                    </span>
                  )}
                  <div className="flex-1">
                    <h3 className="font-serif text-lg text-ink mb-1">{item.name}</h3>
                    <p className="text-sm text-muted mb-3">{item.credits}</p>
                    <span className="inline-block text-[11px] font-mono text-muted bg-warm px-2 py-0.5 rounded-md border border-border">
                      Valid {item.tag}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <span className="text-2xl font-semibold text-ink">S${item.price.toLocaleString()}</span>
                    {item.pending ? (
                      <span className="text-xs text-muted font-medium">Pending</span>
                    ) : (
                      <Link
                        href={`/checkout?package=${item.id}`}
                        className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                      >
                        Purchase
                      </Link>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Unlimited cards */}
        {activeTab === "unlimited" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
            {UNLIMITED.map((item, i) => (
              <motion.div key={item.id} custom={i + 1} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                <div className={cn(
                  "relative bg-card border rounded-xl p-6 flex flex-col gap-4 h-full",
                  item.highlight ? "border-accent shadow-hover" : "border-border"
                )}>
                  {item.highlight && (
                    <span className="absolute -top-2.5 left-4 text-[10px] font-mono uppercase tracking-wider bg-accent text-white px-2.5 py-0.5 rounded-full">
                      Best value
                    </span>
                  )}
                  <div className="flex-1">
                    <h3 className="font-serif text-xl text-ink mb-1">{item.name}</h3>
                    <p className="text-sm text-muted mb-3">Unlimited classes for {item.duration}</p>
                    <div className="flex items-center gap-1.5 text-sage text-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      All group classes included
                    </div>
                    <div className="flex items-center gap-1.5 text-sage text-sm mt-1">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      No class limit per week
                    </div>
                    <span className="inline-block text-[11px] font-mono text-muted bg-warm px-2 py-0.5 rounded-md border border-border mt-3">
                      Valid {item.duration}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <span className="text-2xl font-semibold text-ink">S${item.price.toLocaleString()}</span>
                    <Link
                      href={`/checkout?package=${item.id}`}
                      className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                    >
                      Purchase
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.section>

      {/* ── Section 2: Private Sessions ───────────────────── */}
      <motion.section initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}>
        <SectionHeader
          title="Personal Training (VIP)"
          subtitle="One-on-one or semi-private training with our instructors. PT uses credits — 1 credit = 30 mins. PT credits are separate from group class credits."
        />

        <InfoNote>
          PT packages give you PT credits, which are separate from your group class credits. 1 PT credit = 30 mins of personal training. You may hold both a class package and a PT package at the same time.
        </InfoNote>

        <div className="mt-8 space-y-10">
          {/* 1-on-1 */}
          <div>
            <h3 className="font-serif text-xl text-ink mb-1">1-on-1 Personal Training</h3>
            <p className="text-sm text-muted mb-5">Fully dedicated time with one of our instructors, tailored entirely to your goals.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {PRIVATE_1ON1.map((item, i) => (
                <motion.div key={item.id} custom={i + 1} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                  <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 text-center h-full">
                    <div className="flex-1">
                      <p className="text-2xl font-semibold text-ink">{item.credits}</p>
                      <p className="text-xs text-muted mt-0.5">PT credits</p>
                      <p className="text-[11px] text-muted/60 mt-1">{item.sessions} sessions</p>
                    </div>
                    <div>
                      <p className="text-base font-semibold text-ink">S${item.price.toLocaleString()}</p>
                      <p className="text-[11px] font-mono text-muted">${item.creditRate}/credit</p>
                    </div>
                    <Link
                      href={`/checkout?package=${item.id}`}
                      className="block w-full py-2 text-xs font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                    >
                      Purchase
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* 2-on-1 */}
          <div>
            <h3 className="font-serif text-xl text-ink mb-1">2-on-1 Personal Training</h3>
            <p className="text-sm text-muted mb-5">Train with a partner. Shared cost, shared motivation, same dedicated instructor.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PRIVATE_2ON1.map((item, i) => (
                <motion.div key={item.id} custom={i + 1} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                  <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 text-center h-full">
                    <div className="flex-1">
                      <p className="text-2xl font-semibold text-ink">{item.sessions}</p>
                      <p className="text-xs text-muted mt-0.5">sessions</p>
                    </div>
                    <p className="text-base font-semibold text-ink">S${item.price.toLocaleString()}</p>
                    <Link
                      href={`/checkout?package=${item.id}`}
                      className="block w-full py-2 text-xs font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                    >
                      Purchase
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
