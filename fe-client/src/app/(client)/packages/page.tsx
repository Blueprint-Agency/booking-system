"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GatedLink } from "@/components/auth/auth-gate";
import { cn } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { useMockState, hasActiveBundle, hasActiveUnlimited } from "@/lib/mock-state";

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
];

const UNLIMITED: UnlimitedItem[] = [
  { id: "u-3",  name: "3-Month Unlimited",  duration: "3 months",  price: 600 },
  { id: "u-6",  name: "6-Month Unlimited",  duration: "6 months",  price: 1000, highlight: true },
  { id: "u-12", name: "12-Month Unlimited", duration: "12 months", price: 1700 },
];

const PRIVATE_1ON1: PrivateItem[] = [
  { id: "p1-10",  name: "VIP 10 Sessions",  sessions: 10,  price: 1600,  type: "1on1" },
  { id: "p1-20",  name: "VIP 20 Sessions",  sessions: 20,  price: 3000,  type: "1on1" },
  { id: "p1-30",  name: "VIP 30 Sessions",  sessions: 30,  price: 4200,  type: "1on1" },
  { id: "p1-40",  name: "VIP 40 Sessions",  sessions: 40,  price: 5200,  type: "1on1" },
  { id: "p1-50",  name: "VIP 50 Sessions",  sessions: 50,  price: 6000,  type: "1on1" },
  { id: "p1-100", name: "VIP 100 Sessions", sessions: 100, price: 11000, type: "1on1" },
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

  useEffect(() => {
    function fromHash(): MainTab | null {
      const h = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "").toLowerCase() : "";
      if (h === "pt1on1" || h === "private" || h === "1on1" || h === "1-on-1") return "pt1on1";
      if (h === "pt2on1" || h === "2on1" || h === "2-on-1") return "pt2on1";
      if (h === "classcredits" || h === "classes" || h === "credits") return "classCredits";
      return null;
    }
    const initial = fromHash();
    if (initial) setActiveTab(initial);
    const onHash = () => {
      const next = fromHash();
      if (next) setActiveTab(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [classSubTab, setClassSubTab] = useState<ClassSubTab>("bundle");
  const state = useMockState();
  const hasUnlimited = hasActiveUnlimited(state);
  const hasBundle = hasActiveBundle(state);

  return (
    <>
<div id="packages">
        <BookingSurface maxWidth="xl" padding="default">
          <SectionHeading
            eyebrow="Choose your track"
            title="Three package families"
          />

          {/* ── Main tab strip ──────────────────────────────────── */}
          <div className="flex justify-center mb-6">
            <div
              role="tablist"
              aria-label="Package family"
              className="inline-flex items-center gap-1 p-1 rounded-full bg-warm border border-ink/10"
            >
              {MAIN_TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "relative rounded-full px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-200",
                      isActive
                        ? "bg-ink text-paper shadow-sm"
                        : "text-muted hover:text-ink"
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Class Credits tab ───────────────────────────────── */}
          {activeTab === "classCredits" && (
            <div className="space-y-8">
              {/* Sub-toggle: Bundle / Unlimited */}
              <div
                role="tablist"
                aria-label="Class credit type"
                className="flex justify-center gap-8"
              >
                {(["bundle", "unlimited"] as ClassSubTab[]).map((sub) => {
                  const isActive = classSubTab === sub;
                  return (
                    <button
                      key={sub}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setClassSubTab(sub)}
                      className={cn(
                        "relative pb-3 text-sm font-medium transition-colors",
                        isActive ? "text-ink" : "text-muted hover:text-ink"
                      )}
                    >
                      {sub === "bundle" ? "Credit Bundles" : "Unlimited Access"}
                      <span
                        className={cn(
                          "absolute left-0 right-0 -bottom-px h-0.5 rounded-full transition-all",
                          isActive ? "bg-ink" : "bg-transparent"
                        )}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Bundle cards */}
              {classSubTab === "bundle" && (
                <>
                {hasUnlimited && (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
                    You have an active Unlimited pass. Credit Bundles can't be purchased while Unlimited is active.
                  </div>
                )}
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
                      ) : hasUnlimited ? (
                        <span
                          title="Unlimited pass already active"
                          className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium cursor-not-allowed"
                        >
                          Unavailable
                        </span>
                      ) : (
                        <GatedLink
                          href={`/checkout?package=${item.id}`}
                          context="buy a package"
                          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                        >
                          Purchase
                        </GatedLink>
                      )}
                    </div>
                  ))}
                </div>
                </>
              )}

              {/* Unlimited cards */}
              {classSubTab === "unlimited" && (
                <>
                {hasBundle && !hasUnlimited && (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
                    You still have an active Credit Bundle. Unlimited can't be purchased while a bundle has credits remaining.
                  </div>
                )}
                {hasUnlimited && (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
                    You already have an active Unlimited pass. You can purchase a new one after it expires.
                  </div>
                )}
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
                      {hasBundle || hasUnlimited ? (
                        <span
                          title={hasUnlimited ? "Unlimited pass already active" : "Credit Bundle still active"}
                          className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium cursor-not-allowed"
                        >
                          {hasUnlimited ? "Already active" : "Unavailable"}
                        </span>
                      ) : (
                        <GatedLink
                          href={`/checkout?package=${item.id}`}
                          context="buy a package"
                          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                        >
                          Purchase
                        </GatedLink>
                      )}
                    </div>
                  ))}
                </div>
                </>
              )}
            </div>
          )}

          {/* ── PT 1-on-1 tab ───────────────────────────────────── */}
          {activeTab === "pt1on1" && (
            <div className="space-y-4">
              <p className="text-sm text-muted text-center max-w-xl mx-auto">
                Fully dedicated time with one of our instructors, tailored entirely to your goals. Private packages are measured in sessions (not credits) — 1 session = 30 mins.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                {PRIVATE_1ON1.map((item) => (
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
                      <li>{item.sessions} personal training sessions</li>
                      <li>S${Math.round(item.price / item.sessions)}/session</li>
                      <li>Valid across both locations</li>
                    </ul>
                    <GatedLink
                      href={`/checkout?package=${item.id}`}
                      context="buy a package"
                      className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                    >
                      Purchase
                    </GatedLink>
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
                    <GatedLink
                      href={`/checkout?package=${item.id}`}
                      context="buy a package"
                      className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                    >
                      Purchase
                    </GatedLink>
                  </div>
                ))}
              </div>
            </div>
          )}
        </BookingSurface>
      </div>

    </>
  );
}
