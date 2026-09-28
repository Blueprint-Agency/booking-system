"use client";

import { useMemberSession } from "./member-auth";
import { ApiError, useApi } from "./api";
import { useCachedResource } from "./resource-cache";

// ── Wire types (mirror BE serialization) ─────────────────────────────────────

export interface ApiLocationLite {
  id: string;
  name: string;
  address: string | null;
}

export interface ApiClassTypeLite {
  id: string;
  name: string;
}

export interface ApiInstructorLite {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface ApiWorkshopPromotion {
  id: string;
  label: string;
  kind: "percent" | "special_price";
  percent_off: number | null;
  special_price_sgd: string | null;
  starts_at: string;
  ends_at: string;
}

export interface ApiWorkshopDay {
  id: string;
  ord: number;
  starts_at: string;
  ends_at: string;
}

export interface ApiWorkshopTier {
  id: string;
  name: string;
  description: string | null;
  regular_price_sgd: string;
  early_bird_price_sgd: string | null;
  early_bird_cutoff_at: string | null;
  early_bird_quota: number | null;
  effective_price_sgd: string;
  applied_promotion_id: string | null;
  ord: number;
  day_ids: string[];
  promotions: ApiWorkshopPromotion[];
}

export interface ApiWorkshopCard {
  id: string;
  name: string;
  description_html: string | null;
  lifecycle: "active" | "cancelled";
  location: ApiLocationLite | null;
  cover_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  min_price_sgd: string | null;
  has_discount: boolean;
  days_count: number;
  tiers_count: number;
  /** ID of the workshop's main instructor (nullable until published). */
  main_instructor_id: string | null;
  supporting_instructor_ids: string[];
  /** Back-compat — [main, ...supporting]. */
  instructor_ids: string[];
}

export interface ApiWorkshopDetail extends ApiWorkshopCard {
  images: { id: string; url: string | null; ord: number }[];
  days: ApiWorkshopDay[];
  tiers: ApiWorkshopTier[];
  /** Hydrated instructor records ordered [main, ...supporting]. */
  instructors: ApiInstructorLite[];
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Loads the workshop catalogue. Workshops are members-only — the API has no
 * signed-out read — so a visitor without a session gets `signedOut` and no
 * request is made.
 */
export function useWorkshops(): {
  data: ApiWorkshopCard[] | null;
  loading: boolean;
  signedOut: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, session } = useMemberSession();
  const api = useApi();
  const signedOut = isLoaded && !session;
  const { data, loading, error } = useCachedResource(
    isLoaded && session ? `workshops:${session.userId}` : null,
    async () => (await api.get<{ workshops: ApiWorkshopCard[] }>("/me/workshops")).workshops,
  );
  if (signedOut) return { data: null, loading: false, signedOut, error: null };
  return { data, loading, signedOut, error };
}

/** One workshop, for a signed-in member only — see `useWorkshops`. */
export function useWorkshop(id: string | undefined): {
  data: ApiWorkshopDetail | null;
  loading: boolean;
  signedOut: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, session } = useMemberSession();
  const api = useApi();
  const signedOut = isLoaded && !session;
  const { data, loading, error } = useCachedResource(
    isLoaded && session && id ? `workshop:${session.userId}:${id}` : null,
    () => api.get<ApiWorkshopDetail>(`/me/workshops/${id}`),
  );
  if (signedOut) return { data: null, loading: false, signedOut, error: null };
  // Another workshop's page is never drawn under this one's address.
  return { data: data?.id === id ? data : null, loading, signedOut, error };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export { formatSgd } from "./utils";

export { formatWorkshopDates } from "./workshop-dates";

/**
 * Returns the effective price for a tier, factoring in the early-bird cutoff:
 *  - if early_bird_cutoff_at is in the future and early_bird_price_sgd is set,
 *    that's the price
 *  - otherwise use the workshop-level promo's effective_price_sgd (which the
 *    BE already resolved against regular_price_sgd via best-price-wins)
 */
export function tierEffectivePrice(tier: ApiWorkshopTier, now = new Date()): {
  amount: string;
  isEarlyBird: boolean;
  hasStrike: boolean;
  strikeFrom: string;
} {
  const eb =
    tier.early_bird_price_sgd != null &&
    tier.early_bird_cutoff_at &&
    new Date(tier.early_bird_cutoff_at) > now
      ? tier.early_bird_price_sgd
      : null;
  if (eb !== null) {
    return {
      amount: eb,
      isEarlyBird: true,
      hasStrike: Number(eb) < Number(tier.regular_price_sgd),
      strikeFrom: tier.regular_price_sgd,
    };
  }
  const eff = tier.effective_price_sgd ?? tier.regular_price_sgd;
  const hasStrike = Number(eff) < Number(tier.regular_price_sgd);
  return {
    amount: eff,
    isEarlyBird: false,
    hasStrike,
    strikeFrom: tier.regular_price_sgd,
  };
}
