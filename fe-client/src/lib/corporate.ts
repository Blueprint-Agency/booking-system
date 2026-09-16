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
 * Submits a corporate request — no payment. Creates one pending corporate request
 * the studio then arranges over WhatsApp. The optional `location` (chosen venue —
 * a studio name or the member's own venue) and `notes` are stored on the request
 * for the admin to review.
 */
export function submitCorporateRequest(
  api: Api,
  packageId: string,
  details?: { location?: string; notes?: string },
): Promise<{ corporate_request_id: string }> {
  return api.post<{ corporate_request_id: string }>("/me/corporate-requests", {
    package_id: packageId,
    ...(details?.location ? { preferred_location: details.location } : {}),
    ...(details?.notes ? { notes: details.notes } : {}),
  });
}

/**
 * The studio's own WhatsApp number, from `tenant_settings.copy["contact.whatsapp"]`.
 *
 * This used to be a constant — tenant #1's real number, compiled into the
 * bundle every studio serves, so a member of any other studio who tapped
 * "arrange over WhatsApp" messaged tenant #1. There is no sensible fallback for
 * a phone number, which is why these return `null` rather than a platform one:
 * a studio that has set none simply does not offer the link.
 *
 * Digits only, country code first and no `+` — WhatsApp's own deep-link format.
 */
export const WHATSAPP_COPY_KEY = "contact.whatsapp";

function whatsappHref(phone: string | null | undefined, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const text = encodeURIComponent(message);
  return `https://api.whatsapp.com/send/?phone=${digits}&text=${text}&type=phone_number&app_absent=0`;
}

/** The deep link used to arrange a purchased corporate package. */
export function corporateWhatsappHref(
  phone: string | null | undefined,
  packageName: string,
): string | null {
  return whatsappHref(
    phone,
    `Hi! I just purchased the ${packageName} corporate package and would like to arrange the sessions.`,
  );
}

/** General "contact us" link for the corporate catalog page. */
export function corporateContactWhatsappHref(phone: string | null | undefined): string | null {
  return whatsappHref(phone, "Hi! I'd like to know more about your corporate yoga packages.");
}
