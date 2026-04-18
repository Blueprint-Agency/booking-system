"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CtaBanner } from "@/components/marketing/cta-banner";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";

// ── Inline data (no products.json — data lives here) ──────────────────────────

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
  { id: "b-otp",    name: "One-time Pass",  credits: "1 credit",    price: 40,   tag: "1 day" },
  { id: "b-10",     name: "Bundle of 10",   credits: "10 credits",  price: 300,  tag: "90 days" },
  { id: "b-20",     name: "Bundle of 20",   credits: "20 credits",  price: 550,  tag: "180 days", highlight: true },
  { id: "b-30",     name: "Bundle of 30",   credits: "30 credits",  price: 750,  tag: "365 days" },
  { id: "b-50",     name: "Bundle of 50",   credits: "50 credits",  price: 1100, tag: "365 days" },
  { id: "b-100",    name: "Bundle of 100",  credits: "100 credits", price: 2000, tag: "365 days" },
  { id: "b-travel", name: "Travel Package", credits: "5 credits",   price: 60,   tag: "30 days",  pending: true },
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

// ── Tab definitions ────────────────────────────────────────────────────────────

type MainTab = "classCredits" | "pt1on1" | "pt2on1";
type ClassSubTab = "bundle" | "unlimited";

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "classCredits", label: "Class Credits" },
  { key: "pt1on1",       label: "PT 1-on-1" },
  { key: "pt2on1",       label: "PT 2-on-1" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("classCredits");
  const [classSubTab, setClassSubTab] = useState<ClassSubTab>("bundle");

  return (
    <>
<div id="packages">
        <BookingSurface maxWidth="xl" padding="default">
          <SectionHeading
            eyebrow="Choose your track"
            title="Three package families"
          />

          {/* ── Main tab strip ──────────────────────────────────── */}
          <div className="flex justify-center gap-2 mb-10">
            {MAIN_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "rounded-full px-6 py-2.5 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-ink text-paper"
                    : "bg-transparent text-muted hover:text-ink border border-ink/10"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Class Credits tab ───────────────────────────────── */}
          {activeTab === "classCredits" && (
            <div className="space-y-8">
              {/* Sub-toggle: Bundle / Unlimited */}
              <div className="flex justify-center gap-2">
                {(["bundle", "unlimited"] as ClassSubTab[]).map((sub) => (
                  <button
                    key={sub}
                    onClick={() => setClassSubTab(sub)}
                    className={cn(
                      "rounded-full px-6 py-2.5 text-sm font-medium transition-colors",
                      classSubTab === sub
                        ? "bg-ink text-paper"
                        : "bg-transparent text-muted hover:text-ink border border-ink/10"
                    )}
                  >
                    {sub === "bundle" ? "Credit Bundles" : "Unlimited Access"}
                  </button>
                ))}
              </div>

              {/* Bundle cards */}
              {classSubTab === "bundle" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {BUNDLES.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all",
                        item.highlight && "border-accent",
                        item.pending && "opacity-75"
                      )}
                    >
                      {item.highlight && (
                        <span className="absolute -top-2.5 left-4 text-[10px] font-mono uppercase tracking-wider bg-accent text-white px-2.5 py-0.5 rounded-full">
                          Most popular
                        </span>
                      )}
                      {item.pending && (
                        <span className="absolute -top-2.5 right-4 text-[10px] font-mono uppercase tracking-wider bg-warning/15 text-warning border border-warning/20 px-2.5 py-0.5 rounded-full">
                          Coming soon
                        </span>
                      )}
                      <div>
                        <p className="text-4xl font-extrabold text-ink">{item.credits}</p>
                        <p className="text-base font-medium text-ink mt-0.5">{item.name}</p>
                      </div>
                      <p className="text-2xl font-bold mt-4">S${item.price.toLocaleString()}</p>
                      <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                        <li>Valid for {item.tag}</li>
                        <li>Use at both studio locations</li>
                        <li>1 credit = 1 class attendance</li>
                      </ul>
                      {item.pending ? (
                        <span className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium">
                          Coming soon
                        </span>
                      ) : (
                        <Link
                          href={`/checkout?package=${item.id}`}
                          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                        >
                          Purchase
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Unlimited cards */}
              {classSubTab === "unlimited" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {UNLIMITED.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all",
                        item.highlight && "border-accent"
                      )}
                    >
                      {item.highlight && (
                        <span className="absolute -top-2.5 left-4 text-[10px] font-mono uppercase tracking-wider bg-accent text-white px-2.5 py-0.5 rounded-full">
                          Best value
                        </span>
                      )}
                      <div>
                        <p className="text-4xl font-extrabold text-ink">{item.duration}</p>
                        <p className="text-base font-medium text-ink mt-0.5">{item.name}</p>
                      </div>
                      <p className="text-2xl font-bold mt-4">S${item.price.toLocaleString()}</p>
                      <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                        <li>Unlimited classes for {item.duration}</li>
                        <li>All group classes included</li>
                        <li>No class limit per week</li>
                        <li>Valid across both locations</li>
                      </ul>
                      <Link
                        href={`/checkout?package=${item.id}`}
                        className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                      >
                        Purchase
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PT 1-on-1 tab ───────────────────────────────────── */}
          {activeTab === "pt1on1" && (
            <div className="space-y-4">
              <p className="text-sm text-muted text-center max-w-xl mx-auto">
                Fully dedicated time with one of our instructors, tailored entirely to your goals. PT credits are separate from group class credits — 1 PT credit = 30 mins.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                {PRIVATE_1ON1.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all"
                  >
                    <div>
                      <p className="text-4xl font-extrabold text-ink">{item.credits}</p>
                      <p className="text-base font-medium text-ink mt-0.5">{item.name}</p>
                    </div>
                    <p className="text-2xl font-bold mt-4">S${item.price.toLocaleString()}</p>
                    <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                      <li>{item.sessions} personal training sessions</li>
                      <li>1 PT credit = 30 mins</li>
                      {item.creditRate && <li>S${item.creditRate}/credit</li>}
                      <li>Valid across both locations</li>
                    </ul>
                    <Link
                      href={`/checkout?package=${item.id}`}
                      className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                    >
                      Purchase
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PT 2-on-1 tab ───────────────────────────────────── */}
          {activeTab === "pt2on1" && (
            <div className="space-y-4">
              <p className="text-sm text-muted text-center max-w-xl mx-auto">
                Train with a partner. Shared cost, shared motivation, same dedicated instructor. Split the price between two people.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                {PRIVATE_2ON1.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all"
                  >
                    <div>
                      <p className="text-4xl font-extrabold text-ink">{item.sessions}</p>
                      <p className="text-base font-medium text-ink mt-0.5">{item.name}</p>
                    </div>
                    <p className="text-2xl font-bold mt-4">S${item.price.toLocaleString()}</p>
                    <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                      <li>{item.sessions} semi-private sessions</li>
                      <li>Train with one partner</li>
                      <li>Dedicated instructor throughout</li>
                      <li>Valid across both locations</li>
                    </ul>
                    <Link
                      href={`/checkout?package=${item.id}`}
                      className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                    >
                      Purchase
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </BookingSurface>
      </div>

      <CtaBanner
        imageKey="cta-community"
        headline="Not sure which package fits?"
        subheadline="Book a free intro call and we'll help you pick."
        primaryCta={{ href: "/private-sessions", label: "Talk to us" }}
      />
    </>
  );
}
