"use client";

import { useMemberSession } from "./member-auth";
import { ApiError, publicApi, useApi } from "./api";
import { useCachedResource } from "./resource-cache";

// ── Wire types (snake_case as returned by BE) ────────────────────────────────

export type ApiClassPackageKind = "credit_bundle" | "unlimited" | "trial";
export type ApiPtSessionType = "1on1" | "2on1";

export interface ApiPromotion {
  id: string;
  label: string;
  kind: "percent" | "special_price";
  percent_off: number | null;
  special_price_sgd: string | null;
  starts_at: string;
  ends_at: string;
}

export interface ApiClassPackage {
  id: string;
  name: string;
  description: string | null;
  kind: ApiClassPackageKind;
  credits: number | null;
  validity_days: number | null;
  duration_months: number | null;
  price_sgd: string;
  effective_price_sgd: string;
  applied_promotion_id: string | null;
  promotions: ApiPromotion[];
}

export interface ApiPtPackage {
  id: string;
  name: string;
  description: string | null;
  session_type: ApiPtSessionType;
  num_sessions: number;
  /** How long the purchase lasts, in days. Always set — a PT package always expires. */
  validity_days: number;
  /**
   * Instructor-Bound: buying this package means choosing one active instructor
   * at checkout, and the purchase lands tied to them. False asks nothing.
   */
  instructor_bound: boolean;
  price_sgd: string;
  effective_price_sgd: string;
  applied_promotion_id: string | null;
  promotions: ApiPromotion[];
}

export interface CatalogEntitlements {
  trial_used: boolean;
  /** Trial is for brand-new members only — true iff the client owns no packages yet. */
  trial_eligible: boolean;
  has_active_unlimited: boolean;
  has_active_bundle_credits: boolean;
}

export interface PackagesCatalog {
  classPackages: ApiClassPackage[];
  ptPackages: ApiPtPackage[];
  entitlements: CatalogEntitlements | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Loads the package catalog. Uses the authenticated client endpoints when the
 * user is signed in (so entitlements come back), otherwise the public catalog.
 *
 *   - signed in: GET /me/class-packages, GET /me/pt-packages
 *   - signed out: GET /public/packages
 */
export function usePackagesCatalog(): {
  data: PackagesCatalog | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => Promise<void>;
} {
  const { isLoaded, session } = useMemberSession();
  const api = useApi();

  return useCachedResource<PackagesCatalog>(
    isLoaded ? `packages:${session?.userId ?? "public"}` : null,
    async () => {
      if (session) {
        const [cls, pt] = await Promise.all([
          api.get<{
            class_packages: ApiClassPackage[];
            entitlements: CatalogEntitlements;
          }>("/me/class-packages"),
          api.get<{ pt_packages: ApiPtPackage[] }>("/me/pt-packages"),
        ]);
        return {
          classPackages: cls.class_packages,
          ptPackages: pt.pt_packages,
          entitlements: cls.entitlements,
        };
      }
      const res = await publicApi.get<{
        class_packages: ApiClassPackage[];
        pt_packages: ApiPtPackage[];
      }>("/public/packages");
      return {
        classPackages: res.class_packages,
        ptPackages: res.pt_packages,
        entitlements: null,
      };
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export { formatSgd } from "./utils";

export function hasDiscount(p: ApiClassPackage | ApiPtPackage): boolean {
  return Number(p.effective_price_sgd) < Number(p.price_sgd);
}
