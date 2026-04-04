// Centralized mock user state — single source of truth for the prototype.
// In production this comes from the API / auth context.

export type UserPackage = {
  id: string;
  name: string;
  creditsRemaining: number;
  creditsTotal: number;
  expiresAt: string;
  unlimited: boolean;
};

export const MOCK_USER = {
  id: "client-1",
  name: "Sarah Koh",
  initials: "SK",

  // ── Class credits (aggregate) ───────────────
  classCredits: 8,
  classPackageName: "Bundle of 10",
  classPackageTotal: 10,
  classPackageExpiry: "2026-06-15",
  classPackageUnlimited: false,

  // ── Multiple class packages ─────────────────
  classPackages: [
    { id: "cp-1", name: "Bundle of 10", creditsRemaining: 5, creditsTotal: 10, expiresAt: "2026-06-15", unlimited: false },
    { id: "cp-2", name: "Bundle of 20", creditsRemaining: 3, creditsTotal: 20, expiresAt: "2026-08-10", unlimited: false },
  ] as UserPackage[],

  // ── PT credits (1-on-1) ──────────────────────
  pt1on1Credits: 6,
  pt1on1PackageName: "VIP 10 (1-on-1)",
  pt1on1PackageTotal: 20,
  pt1on1PackageExpiry: "2026-09-01",

  // ── PT credits (2-on-1) ──────────────────────
  pt2on1Credits: 0,
  pt2on1PackageName: null as string | null,
  pt2on1PackageTotal: 0,
  pt2on1PackageExpiry: null as string | null,

  // ── Membership (null if not subscribed) ──────
  membership: null as null | {
    name: string;
    status: "active" | "cancelled" | "past_due";
    nextBilling: string;
  },
};

export type MockUser = typeof MOCK_USER;
