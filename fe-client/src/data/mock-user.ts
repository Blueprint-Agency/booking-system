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
  name: "Guest",
  initials: "G",

  // ── Class credits (aggregate) ───────────────
  classCredits: 0,
  classPackageName: "" as string | "",
  classPackageTotal: 0,
  classPackageExpiry: "" as string | "",
  classPackageUnlimited: false,

  // ── Multiple class packages ─────────────────
  classPackages: [] as UserPackage[],

  // ── PT credits (1-on-1) ──────────────────────
  pt1on1Credits: 0,
  pt1on1PackageName: null as string | null,
  pt1on1PackageTotal: 0,
  pt1on1PackageExpiry: null as string | null,

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
