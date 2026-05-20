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
  instructor: { id: string; name: string };
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

export interface ApiClassDetail extends ApiClassCard {
  class_type: { id: string; name: string; description: string | null };
  location:
    | { id: string; name: string; address: string | null; gmaps_url: string | null }
    | null;
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

export function useClass(id: string | undefined): {
  data: ApiClassDetail | null;
  loading: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiClassDetail | null>(null);
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
          ? await api.get<ApiClassDetail>(`/me/classes/${id}`)
          : await publicApi.get<ApiClassDetail>(`/public/classes/${id}`);
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

export interface ClassEntitlements {
  trial_used: boolean;
  has_active_unlimited: boolean;
  has_active_bundle_credits: boolean;
}

/** Whether the signed-in client currently holds something that can pay for a class. */
export function useCanBookClass(): { canBook: boolean; loaded: boolean } {
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
  return { canBook, loaded };
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
  });
}

export function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

export interface ApiInstructor {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
}

export function useInstructors(): { data: ApiInstructor[] | null; loading: boolean } {
  const [data, setData] = useState<ApiInstructor[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await publicApi.get<{ instructors: ApiInstructor[] }>("/public/instructors");
        if (!cancelled) setData(res.instructors);
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

export interface ApiPtSlot {
  id: string;
  instructor_id: string;
  starts_at: string;
  ends_at: string;
  session_type: "1on1" | "2on1";
  spots_left: number;
  location: { id: string; name: string } | null;
}

/** Fetches availability for each instructor id (in parallel) and merges, tagging each slot with its instructor_id. */
export function usePtAvailability(instructorIds: string[]): {
  data: ApiPtSlot[] | null;
  loading: boolean;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiPtSlot[] | null>(null);
  const [loading, setLoading] = useState(false);

  const key = instructorIds.join(",");

  useEffect(() => {
    if (!isLoaded) return;
    if (instructorIds.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const client = isSignedIn ? api : publicApi;
    const base = isSignedIn ? "/me" : "/public";
    (async () => {
      try {
        const results = await Promise.all(
          instructorIds.map((id) =>
            client
              .get<{ slots: Omit<ApiPtSlot, "instructor_id">[] }>(`${base}/instructors/${id}/availability`)
              .then((r) => r.slots.map((s) => ({ ...s, instructor_id: id })))
              .catch(() => [] as ApiPtSlot[]),
          ),
        );
        if (!cancelled) setData(results.flat());
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, api, key]);

  return { data, loading };
}
