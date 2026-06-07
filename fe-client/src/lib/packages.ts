"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { ApiError, publicApi, useApi } from "./api";

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
  duration_days: number | null;
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
  const { isSignedIn, isLoaded } = useUser();
  const api = useApi();
  const [data, setData] = useState<PackagesCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  async function load() {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      if (isSignedIn) {
        const [cls, pt] = await Promise.all([
          api.get<{
            class_packages: ApiClassPackage[];
            entitlements: CatalogEntitlements;
          }>("/me/class-packages"),
          api.get<{ pt_packages: ApiPtPackage[] }>("/me/pt-packages"),
        ]);
        setData({
          classPackages: cls.class_packages,
          ptPackages: pt.pt_packages,
          entitlements: cls.entitlements,
        });
      } else {
        const res = await publicApi.get<{
          class_packages: ApiClassPackage[];
          pt_packages: ApiPtPackage[];
        }>("/public/packages");
        setData({
          classPackages: res.class_packages,
          ptPackages: res.pt_packages,
          entitlements: null,
        });
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  return { data, loading, error, refresh: load };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatSgd(price: string | number): string {
  const n = typeof price === "string" ? Number(price) : price;
  return `S$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function hasDiscount(p: ApiClassPackage | ApiPtPackage): boolean {
  return Number(p.effective_price_sgd) < Number(p.price_sgd);
}
