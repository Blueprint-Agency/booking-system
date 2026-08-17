"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { ApiError, publicApi, useApi } from "./api";

export interface ApiClassLocation {
  id: string;
  name: string;
  address: string | null;
}

export interface ApiClassCard {
  id: string;
  class_type: { id: string; name: string };
  /** Main instructor — kept for back-compat alongside `main_instructor_id`. */
  instructor: { id: string; name: string };
  main_instructor_id: string;
  supporting_instructor_ids: string[];
  /** Back-compat — [main, ...supporting]. */
  instructor_ids: string[];
  location: ApiClassLocation | null;
  room: { id: string; name: string } | null;
  starts_at: string;
  ends_at: string;
  credit_cost: number;
  capacity_online: number;
  booked_count: number;
  spots_left: number;
  lifecycle: string;
  is_booked?: boolean;
}

export interface ApiLocationFull {
  id: string;
  name: string;
  address: string | null;
  gmaps_url: string | null;
  phone: string | null;
}

export interface ClassFilters {
  location_id?: string;
  instructor_id?: string;
  class_type_id?: string;
  from?: string;
  to?: string;
}

export function useClasses(filters: ClassFilters): {
  data: ApiClassCard[] | null;
  loading: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiClassCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const key = JSON.stringify(filters);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) if (v) query[k] = v;
    (async () => {
      try {
        const res = isSignedIn
          ? await api.get<{ classes: ApiClassCard[] }>("/me/classes", query)
          : await publicApi.get<{ classes: ApiClassCard[] }>("/public/classes", query);
        if (!cancelled) setData(res.classes);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, api, key]);

  return { data, loading, error };
}

export function useLocations(): {
  data: ApiLocationFull[] | null;
  loading: boolean;
} {
  const [data, setData] = useState<ApiLocationFull[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await publicApi.get<{ locations: ApiLocationFull[] }>("/public/locations");
        if (!cancelled) setData(res.locations);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { data, loading };
}

export interface ApiClassType {
  id: string;
  name: string;
}

/** Active class types for the PT request form's dropdown. Public (no auth). */
export function useClassTypes(): { data: ApiClassType[] | null; loading: boolean } {
  const [data, setData] = useState<ApiClassType[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await publicApi.get<{ class_types: ApiClassType[] }>("/public/class-types");
        if (!cancelled) setData(res.class_types);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { data, loading };
}

export interface ClassEntitlements {
  trial_used: boolean;
  has_active_unlimited: boolean;
  has_active_bundle_credits: boolean;
  /**
   * The one studio the member's Unlimited Plan covers, or null when they hold
   * none. The backend decides which plan this is; the schedule only compares it
   * against the Location already on every class card, so the class list stays
   * anonymous and cacheable. Presentation only — booking is the enforcement.
   */
  unlimited_location: { id: string; name: string } | null;
  /**
   * The Cross-Location Add-On the nudge on a blocked class offers (§5): the plan
   * it would attach to, whether that plan already Covers both Locations, and the
   * rate to quote. All three are decided by the backend — the schedule only
   * renders them.
   */
  unlimited_plan_id: string | null;
  unlimited_covers_both: boolean;
  cross_location_rate_sgd: string;
}

/** Whether the signed-in client currently holds something that can pay for a class. */
export function useCanBookClass(): {
  canBook: boolean;
  loaded: boolean;
  entitlements: ClassEntitlements | null;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [ent, setEnt] = useState<ClassEntitlements | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setEnt(null);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ entitlements: ClassEntitlements }>("/me/class-packages");
        if (!cancelled) setEnt(res.entitlements);
      } catch {
        if (!cancelled) setEnt(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, api]);

  const canBook = !!ent && (ent.has_active_unlimited || ent.has_active_bundle_credits);
  return { canBook, loaded, entitlements: ent };
}

export function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatClassTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-SG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  });
}

