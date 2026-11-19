"use client";

import { useMemberSession } from "./member-auth";
import { ApiError, publicApi, useApi } from "./api";
import { useCachedResource } from "./resource-cache";
import type { TrialEntitlements } from "./trial-standing";

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
  /** The Entity it is sold under. Optional: an older server does not send it. */
  entity_id?: string | null;
  entity?: ApiPackageEntity | null;
}

/** The Entity a package belongs to, as every package read names it. */
export interface ApiPackageEntity {
  id: string;
  name: string;
  slug: string;
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
  entity?: ApiPackageEntity | null;
}

export interface CatalogEntitlements extends TrialEntitlements {
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
 *
 * `entity` is the Entity slug whose packages the page shows: a string narrows
 * every read to it, `null` reads them all (a studio with one Entity), and
 * `undefined` holds the read while the page still works out which Entity it is
 * on. It is part of the cache key, or one Entity's list would be drawn under another's.
 */
export function usePackagesCatalog(entity: string | null | undefined): {
  data: PackagesCatalog | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => Promise<void>;
} {
  const { isLoaded, session } = useMemberSession();
  const api = useApi();
  const query = entity ? `?entity=${encodeURIComponent(entity)}` : "";

  return useCachedResource<PackagesCatalog>(
    isLoaded && entity !== undefined ? `packages:${session?.userId ?? "public"}:${entity ?? ""}` : null,
    async () => {
      if (session) {
        const [cls, pt] = await Promise.all([
          api.get<{
            class_packages: ApiClassPackage[];
            entitlements: CatalogEntitlements;
          }>(`/me/class-packages${query}`),
          api.get<{ pt_packages: ApiPtPackage[] }>(`/me/pt-packages${query}`),
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
      }>(`/public/packages${query}`);
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
