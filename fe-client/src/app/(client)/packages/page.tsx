"use client";

import { useEffect, useState } from "react";
import { GatedLink } from "@/components/auth/auth-gate";
import { cn } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { useMockState, hasActiveBundle, hasActiveUnlimited } from "@/lib/mock-state";
import { getApiBaseUrl } from "@/lib/api-url";

// ── API types ─────────────────────────────────────────────────────────────────

interface ClassPackage {
  id: string;
  name: string;
  kind: "credit_bundle" | "unlimited";
  credits: number | null;
  validityDays: number | null;
  durationDays: number | null;
  priceSgd: string;
}

interface PtPackage {
  id: string;
  name: string;
  sessionType: "1on1" | "2on1";
  numSessions: number;
  priceSgd: string;
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type MainTab = "classCredits" | "pt1on1" | "pt2on1";
type ClassSubTab = "bundle" | "unlimited";

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "classCredits", label: "Class Credits" },
  { key: "pt1on1", label: "PT 1-on-1" },
  { key: "pt2on1", label: "PT 2-on-1" },
];

function validityLabel(pkg: ClassPackage): string {
  if (pkg.kind === "credit_bundle" && pkg.validityDays != null) {
    if (pkg.validityDays === 1) return "1 day";
    if (pkg.validityDays < 365) return `${pkg.validityDays} days`;
    return "365 days";
  }
  if (pkg.kind === "unlimited" && pkg.durationDays != null) {
    const months = Math.round(pkg.durationDays / 30);
    return `${months} month${months !== 1 ? "s" : ""}`;
  }
  return "";
}

function creditsLabel(pkg: ClassPackage): string {
  if (pkg.kind === "credit_bundle") return `${pkg.credits} credit${pkg.credits === 1 ? "" : "s"}`;
  const months = pkg.durationDays != null ? Math.round(pkg.durationDays / 30) : "?";
  return `${months} months`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("classCredits");
  const [classSubTab, setClassSubTab] = useState<ClassSubTab>("bundle");
  const [classPkgs, setClassPkgs] = useState<ClassPackage[]>([]);
  const [ptPkgs, setPtPkgs] = useState<PtPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const state = useMockState();
  const hasUnlimited = hasActiveUnlimited(state);
  const hasBundle = hasActiveBundle(state);

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

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/public/packages`)
      .then(res => {
        if (!res.ok) throw new Error("Failed to load packages");
        return res.json();
      })
      .then((data: { classPackages: ClassPackage[]; ptPackages: PtPackage[] }) => {
        setClassPkgs(data.classPackages ?? []);
        setPtPkgs(data.ptPackages ?? []);
      })
      .catch(() => setError("Could not load packages. Please refresh."))
      .finally(() => setLoading(false));
  }, []);

  const bundles = classPkgs.filter(p => p.kind === "credit_bundle");
  const unlimited = classPkgs.filter(p => p.kind === "unlimited");
  const pt1on1 = ptPkgs.filter(p => p.sessionType === "1on1");
  const pt2on1 = ptPkgs.filter(p => p.sessionType === "2on1");

  return (
    <div id="packages">
      <BookingSurface maxWidth="xl" padding="default">
        <SectionHeading eyebrow="Choose your track" title="Three package families" />

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
                    isActive ? "bg-ink text-paper shadow-sm" : "text-muted hover:text-ink"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading && (
          <div className="py-20 text-center text-muted text-sm">Loading packages…</div>
        )}
        {error && (
          <div className="py-10 text-center text-sm text-red-600">{error}</div>
        )}

        {!loading && !error && (
          <>
            {/* ── Class Credits tab ──────────────────────────── */}
            {activeTab === "classCredits" && (
              <div className="space-y-8">
                <div role="tablist" aria-label="Class credit type" className="flex justify-center gap-8">
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
                        <span className={cn(
                          "absolute left-0 right-0 -bottom-px h-0.5 rounded-full transition-all",
                          isActive ? "bg-ink" : "bg-transparent"
                        )} />
                      </button>
                    );
                  })}
                </div>

                {classSubTab === "bundle" && (
                  <>
                    {hasUnlimited && (
                      <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
                        You have an active Unlimited pass. Credit Bundles can&apos;t be purchased while Unlimited is active.
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {bundles.map((pkg) => {
                        const price = parseFloat(pkg.priceSgd);
                        const isHighlight = pkg.credits === 20;
                        return (
                          <div
                            key={pkg.id}
                            className={cn(
                              "relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all",
                              isHighlight && "border-accent"
                            )}
                          >
                            {isHighlight && (
                              <span className="absolute -top-2.5 left-4 text-[10px] font-mono uppercase tracking-wider bg-accent text-white px-2.5 py-0.5 rounded-full">
                                Most popular
                              </span>
                            )}
                            <div>
                              <p className="text-4xl font-extrabold text-ink">{creditsLabel(pkg)}</p>
                              <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
                            </div>
                            <p className="text-2xl font-bold mt-4">S${price.toLocaleString()}</p>
                            <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                              <li>Valid for {validityLabel(pkg)}</li>
                              <li>Use at both studio locations</li>
                              <li>1 credit = 1 class attendance</li>
                            </ul>
                            {hasUnlimited ? (
                              <span
                                title="Unlimited pass already active"
                                className="mt-6 w-full text-center rounded-full bg-ink/10 text-muted px-5 py-3 text-sm font-medium cursor-not-allowed"
                              >
                                Unavailable
                              </span>
                            ) : (
                              <GatedLink
                                href={`/checkout?package=${pkg.id}&kind=class`}
                                context="buy a package"
                                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                              >
                                Purchase
                              </GatedLink>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {classSubTab === "unlimited" && (
                  <>
                    {hasBundle && !hasUnlimited && (
                      <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
                        You still have an active Credit Bundle. Unlimited can&apos;t be purchased while a bundle has credits remaining.
                      </div>
                    )}
                    {hasUnlimited && (
                      <div className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
                        You already have an active Unlimited pass. You can purchase a new one after it expires.
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {unlimited.map((pkg) => {
                        const price = parseFloat(pkg.priceSgd);
                        const months = pkg.durationDays != null ? Math.round(pkg.durationDays / 30) : 0;
                        const isHighlight = months === 6;
                        return (
                          <div
                            key={pkg.id}
                            className={cn(
                              "relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all",
                              isHighlight && "border-accent"
                            )}
                          >
                            {isHighlight && (
                              <span className="absolute -top-2.5 left-4 text-[10px] font-mono uppercase tracking-wider bg-accent text-white px-2.5 py-0.5 rounded-full">
                                Best value
                              </span>
                            )}
                            <div>
                              <p className="text-4xl font-extrabold text-ink">{creditsLabel(pkg)}</p>
                              <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
                            </div>
                            <p className="text-2xl font-bold mt-4">S${price.toLocaleString()}</p>
                            <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                              <li>Unlimited classes for {validityLabel(pkg)}</li>
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
                                href={`/checkout?package=${pkg.id}&kind=class`}
                                context="buy a package"
                                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                              >
                                Purchase
                              </GatedLink>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── PT 1-on-1 tab ───────────────────────────────── */}
            {activeTab === "pt1on1" && (
              <div className="space-y-4">
                <p className="text-sm text-muted text-center max-w-xl mx-auto">
                  Fully dedicated time with one of our instructors, tailored entirely to your goals. Private packages are measured in sessions (not credits) — 1 session = 30 mins.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                  {pt1on1.map((pkg) => {
                    const price = parseFloat(pkg.priceSgd);
                    return (
                      <div
                        key={pkg.id}
                        className="rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all"
                      >
                        <div>
                          <p className="text-4xl font-extrabold text-ink">{pkg.numSessions}</p>
                          <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
                        </div>
                        <p className="text-2xl font-bold mt-4">S${price.toLocaleString()}</p>
                        <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                          <li>{pkg.numSessions} personal training sessions</li>
                          <li>S${Math.round(price / pkg.numSessions)}/session</li>
                          <li>Valid across both locations</li>
                        </ul>
                        <GatedLink
                          href={`/checkout?package=${pkg.id}&kind=pt`}
                          context="buy a package"
                          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                        >
                          Purchase
                        </GatedLink>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── PT 2-on-1 tab ───────────────────────────────── */}
            {activeTab === "pt2on1" && (
              <div className="space-y-4">
                <p className="text-sm text-muted text-center max-w-xl mx-auto">
                  Train with a partner. Shared cost, shared motivation, same dedicated instructor. Split the price between two people.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                  {pt2on1.map((pkg) => {
                    const price = parseFloat(pkg.priceSgd);
                    return (
                      <div
                        key={pkg.id}
                        className="rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all"
                      >
                        <div>
                          <p className="text-4xl font-extrabold text-ink">{pkg.numSessions}</p>
                          <p className="text-base font-medium text-ink mt-0.5">{pkg.name}</p>
                        </div>
                        <p className="text-2xl font-bold mt-4">S${price.toLocaleString()}</p>
                        <ul className="text-sm text-muted space-y-2 mt-6 flex-1">
                          <li>{pkg.numSessions} semi-private sessions</li>
                          <li>Train with one partner</li>
                          <li>Dedicated instructor throughout</li>
                          <li>Valid across both locations</li>
                        </ul>
                        <GatedLink
                          href={`/checkout?package=${pkg.id}&kind=pt`}
                          context="buy a package"
                          className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 mt-6 w-full text-center transition-colors"
                        >
                          Purchase
                        </GatedLink>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </BookingSurface>
    </div>
  );
}
