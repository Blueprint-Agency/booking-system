"use client";

import { useEffect, useRef, useState } from "react";
import { useMemberSession } from "./member-auth";
import { ApiError, publicApi, useApi } from "./api";

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
  /** The Entity it is shown under. Optional: a backend not yet redeployed does not send it. */
  entity?: { id: string; name: string; slug: string } | null;
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
  /** When the studio cancelled it; null unless `status` is `cancelled`. */
  cancelled_at?: string | null;
  /** A cancelled request's lines, as the server's cancellation summary words them. */
  who_line?: string | null;
  outcome_line?: string | null;
  session: ApiCorporateSession | null;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Loads the corporate package catalog. Uses the authenticated client endpoint
 * when the user is signed in, otherwise the public catalog.
 *
 *   - signed in:  GET /me/corporate-packages
 *   - signed out: GET /public/corporate-packages
 *
 * `entity` is the Entity slug whose packages are shown (see `usePackagesCatalog`):
 * a string narrows the read, `null` reads them all, `undefined` holds it. It is
 * a dependency of the load, or the tab would keep the previous Entity's list.
 */
export function useCorporatePackages(entity: string | null | undefined): {
  data: ApiCorporatePackage[] | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => Promise<void>;
} {
  const { isSignedIn, isLoaded } = useMemberSession();
  const api = useApi();
  const [data, setData] = useState<ApiCorporatePackage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  // The newest load; an older one landing late is dropped, so a slow read for
  // the Entity just left cannot overwrite the one now on screen.
  const latest = useRef(0);

  async function load() {
    if (!isLoaded || entity === undefined) return;
    const mine = ++latest.current;
    const query = entity ? `?entity=${encodeURIComponent(entity)}` : "";
    setLoading(true);
    setError(null);
    try {
      const res = isSignedIn
        ? await api.get<{ corporate_packages: ApiCorporatePackage[] }>(
            `/me/corporate-packages${query}`,
          )
        : await publicApi.get<{ corporate_packages: ApiCorporatePackage[] }>(
            `/public/corporate-packages${query}`,
          );
      if (mine !== latest.current) return;
      setData(res.corporate_packages);
    } catch (err) {
      if (mine !== latest.current) return;
      setError(err as Error);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }

  useEffect(() => {
    // The previous Entity's list is not this one's: never drawn while it loads.
    setData(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, entity]);

  return { data, loading, error, refresh: load };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The studio's own WhatsApp number, from `tenant_settings.copy["contact.whatsapp"]`.
 *
 * It is not a constant compiled into the bundle every studio serves: a member
 * of one studio who tapped "arrange over WhatsApp" would message another. There
 * is no sensible fallback for a phone number, which is why these return `null` rather than a platform one:
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
