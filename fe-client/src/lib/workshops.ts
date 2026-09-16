"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { ApiError, publicApi, useApi } from "./api";

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
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
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
 * Loads the workshop catalogue. Falls back to /public/workshops when the user
 * isn't signed in — same data either way for v0.
 */
export function useWorkshops(): {
  data: ApiWorkshopCard[] | null;
  loading: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiWorkshopCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = isSignedIn
          ? await api.get<{ workshops: ApiWorkshopCard[] }>("/me/workshops")
          : await publicApi.get<{ workshops: ApiWorkshopCard[] }>(
              "/public/workshops",
            );
        if (!cancelled) setData(res.workshops);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, api]);

  return { data, loading, error };
}

export function useWorkshop(id: string | undefined): {
  data: ApiWorkshopDetail | null;
  loading: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiWorkshopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    if (!isLoaded || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = isSignedIn
          ? await api.get<ApiWorkshopDetail>(`/me/workshops/${id}`)
          : await publicApi.get<ApiWorkshopDetail>(`/public/workshops/${id}`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isLoaded, isSignedIn, api]);

  return { data, loading, error };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export { formatSgd } from "./utils";

export function formatDayRange(
  startsAt: string | null,
  endsAt: string | null,
): string {
  if (!startsAt) return "TBA";
  const s = new Date(startsAt);
  const e = endsAt ? new Date(endsAt) : null;
  const fmt: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Singapore",
  };
  const sStr = s.toLocaleDateString("en-SG", fmt);
  if (!e) return sStr;
  // Same calendar day → just one date.
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  if (sameDay) return sStr;
  return `${sStr} – ${e.toLocaleDateString("en-SG", fmt)}`;
}

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
