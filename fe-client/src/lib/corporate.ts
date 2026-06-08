"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Api, ApiError, publicApi, useApi } from "./api";

// ── Wire types (snake_case as returned by BE) ────────────────────────────────

export type ApiCorporatePackageStatus = "active" | "archived";
export type ApiCorporateRequestStatus =
  | "pending"
  | "scheduled"
  | "cancelled"
  | "attended";

export interface ApiCorporatePackage {
  id: string;
  name: string;
  description: string | null;
  price_sgd: string;
  status: ApiCorporatePackageStatus;
}

export interface ApiCorporateSession {
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  instructor_name: string | null;
}

export interface ApiCorporateRequest {
  id: string;
  status: ApiCorporateRequestStatus;
  package: { id: string; name: string };
  created_at: string;
  session: ApiCorporateSession | null;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Loads the corporate package catalog. Uses the authenticated client endpoint
 * when the user is signed in, otherwise the public catalog.
 *
 *   - signed in:  GET /me/corporate-packages
 *   - signed out: GET /public/corporate-packages
 */
export function useCorporatePackages(): {
  data: ApiCorporatePackage[] | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => Promise<void>;
} {
  const { isSignedIn, isLoaded } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiCorporatePackage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  async function load() {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const res = isSignedIn
        ? await api.get<{ corporate_packages: ApiCorporatePackage[] }>(
            "/me/corporate-packages",
          )
        : await publicApi.get<{ corporate_packages: ApiCorporatePackage[] }>(
            "/public/corporate-packages",
          );
      setData(res.corporate_packages);
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

/** Loads the signed-in member's corporate requests (authed only). */
export function useCorporateRequests(): {
  data: ApiCorporateRequest[] | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => Promise<void>;
} {
  const { isSignedIn, isLoaded } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiCorporateRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  async function load() {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ corporate_requests: ApiCorporateRequest[] }>(
        "/me/corporate-requests",
      );
      setData(res.corporate_requests);
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

/**
 * Starts Stripe checkout for a corporate package. Returns the Stripe checkout
 * URL — redirect the browser to it (mirrors the paid-package flow). The optional
 * `location` and `notes` carry the member's request-form answers as separate
 * fields; they're stored on the auto-created corporate request once payment
 * completes (admin reviews them individually).
 */
export function purchaseCorporate(
  api: Api,
  packageId: string,
  details?: { location?: string; notes?: string; customLocation?: boolean },
): Promise<{ url: string }> {
  return api.post<{ url: string }>("/me/checkout/package", {
    package_kind: "corporate",
    package_id: packageId,
    ...(details?.location ? { location: details.location } : {}),
    ...(details?.notes ? { notes: details.notes } : {}),
    ...(details?.customLocation ? { custom_location: true } : {}),
  });
}

const WHATSAPP_PHONE = "6582067247";

/** Builds the WhatsApp deep link used to arrange a purchased corporate package. */
export function corporateWhatsappHref(packageName: string): string {
  const text = encodeURIComponent(
    `Hi! I just purchased the ${packageName} corporate package and would like to arrange the sessions.`,
  );
  return `https://api.whatsapp.com/send/?phone=${WHATSAPP_PHONE}&text=${text}&type=phone_number&app_absent=0`;
}

/** General "contact us" WhatsApp link for the corporate catalog page. */
export function corporateContactWhatsappHref(): string {
  const text = encodeURIComponent(
    "Hi! I'd like to know more about your corporate yoga packages.",
  );
  return `https://api.whatsapp.com/send/?phone=${WHATSAPP_PHONE}&text=${text}&type=phone_number&app_absent=0`;
}
