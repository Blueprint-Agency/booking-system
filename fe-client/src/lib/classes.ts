"use client";

import { useCallback, useEffect, useState } from "react";
import { useMemberSession } from "./member-auth";
import { ApiError, publicApi, useApi, type Api } from "./api";
import type { ApiClassWaitlist } from "./waitlist";
import type { ApiClash } from "./clash";
import type { PickerPayload, UnlimitedPlanCoverage } from "./package-picker";
import type { ApiPackageRule } from "./package-rule";

export interface ApiClassLocation {
  id: string;
  name: string;
  address: string | null;
  /** The Location's Google Maps link, set on the portal's Locations page. */
  gmaps_url: string | null;
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
  /** An online seat is free. Whether, never how many: seat counts are the studio's. */
  has_seats: boolean;
  lifecycle: string;
  /** This class's Cancellation Window in hours — its own, else the studio's. */
  effective_cancel_window_hours: number;
  is_booked?: boolean;
  /**
   * Signed in only: the member's own booking this class overlaps, which they
   * must cancel before they can book it (one body, one class at a time).
   */
  clash?: ApiClash | null;
  /** The class's line (spec-waitlist.md §9). `my_entry` is null when signed out. */
  waitlist: ApiClassWaitlist;
  /**
   * The class takes only some packages (its Package rule is not `all`). Just
   * the flag, for the row's "Some packages" hint; which ones is in the detail.
   */
  restricted: boolean;
}

/**
 * `GET /public/classes/:id` — the card, plus what only the class detail
 * overlay shows: the class type's description, the Location's address and map
 * link, the supporting instructors, and the Package rule with its packages named.
 */
export interface ApiClassDetail extends Omit<ApiClassCard, "class_type" | "location"> {
  class_type: { id: string; name: string; difficulty: string; description: string | null };
  location: ApiClassLocation | null;
  supporting_instructors: { id: string; name: string }[];
  package_rule: ApiPackageRule;
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

function fetchClasses(api: Api, signedIn: boolean, filters: ClassFilters): Promise<ApiClassCard[]> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v) query[k] = v;
  return (
    signedIn
      ? api.get<{ classes: ApiClassCard[] }>("/me/classes", query)
      : publicApi.get<{ classes: ApiClassCard[] }>("/public/classes", query)
  ).then((res) => res.classes);
}

export function useClasses(filters: ClassFilters): {
  data: ApiClassCard[] | null;
  loading: boolean;
  error: ApiError | Error | null;
  /** Re-read the feed in place — no loading state, so rows update rather than blink. */
  refresh: () => Promise<void>;
} {
  const { isLoaded, isSignedIn } = useMemberSession();
  const api = useApi();
  const [data, setData] = useState<ApiClassCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const key = JSON.stringify(filters);
  // Fetch the public feed immediately instead of waiting for the session read —
  // anonymous visitors get classes ~a second sooner. When it resolves a
  // session this flips false→true and the effect re-fetches /me/classes for
  // booked-state; for anonymous visitors it stays false, so no double fetch.
  const signedIn = isLoaded && isSignedIn === true;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const classes = await fetchClasses(api, signedIn, filters);
        if (!cancelled) setData(classes);
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
  }, [signedIn, api, key]);

  const refresh = useCallback(async () => {
    try {
      setData(await fetchClasses(api, signedIn, filters));
    } catch {
      // The rows keep what they showed; the next action re-checks with the server.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, api, key]);

  return { data, loading, error, refresh };
}

/**
 * Locations and class types are effectively immutable within a member's visit,
 * so the promise is cached at module level: concurrent mounts share one request
 * and later navigations don't refetch. A failed fetch clears the cache so the
 * next mount retries.
 */
function cacheOnce<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= fn().catch((err) => {
      p = null;
      throw err;
    }));
}

const getLocations = cacheOnce(async () => {
  const res = await publicApi.get<{ locations: ApiLocationFull[] }>("/public/locations");
  return res.locations;
});

const getClassTypes = cacheOnce(async () => {
  const res = await publicApi.get<{ class_types: ApiClassType[] }>("/public/class-types");
  return res.class_types;
});

/** An active instructor of this studio, as the public roster states them. */
export interface ApiInstructorLite {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
}

const getInstructors = cacheOnce(async () => {
  const res = await publicApi.get<{ instructors: ApiInstructorLite[] }>("/public/instructors");
  return res.instructors;
});

/**
 * The studio's active instructors — the checkout picker for an Instructor-Bound
 * PT package. Deliberately the same listing the backend's binding rule checks a
 * pick against, so the picker can never offer somebody the purchase would then
 * be refused for.
 *
 * A failed fetch lands as an empty list, exactly as `useLocations` does; the
 * caller says so rather than leaving a disabled button above an empty picker.
 */
export function useInstructors(): {
  data: ApiInstructorLite[] | null;
  loading: boolean;
} {
  const [data, setData] = useState<ApiInstructorLite[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const instructors = await getInstructors();
        if (!cancelled) setData(instructors);
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
        const locations = await getLocations();
        if (!cancelled) setData(locations);
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
        const classTypes = await getClassTypes();
        if (!cancelled) setData(classTypes);
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
   * The Home Location of the member's first live Unlimited Plan (a running one
   * before a Dormant one), or null when they hold none. A member may hold plans
   * at several Locations; `unlimited_plans` lists them all.
   */
  unlimited_location: { id: string; name: string } | null;
  /**
   * Every live Unlimited Plan, running ones first: its Home Location and
   * whether an Add-On makes it Cover every Location. The schedule compares
   * these against the Location already on every class card, so the class list
   * stays anonymous and cacheable (`planCoverage` in package-picker.ts).
   * Presentation only — booking is the enforcement.
   */
  unlimited_plans: UnlimitedPlanCoverage[];
  /**
   * The plan `unlimited_location` names, and whether it already Covers both
   * Locations. Decided by the backend.
   */
  unlimited_plan_id: string | null;
  unlimited_covers_both: boolean;
  /** The Cross-Location Add-On's rate, as the nudge on an uncovered class quotes it (§5). */
  cross_location_rate_sgd: string;
  /** Some class package is running right now. Several may be. Backend-derived. */
  class_family_running: boolean;
}

/**
 * `GET /me/classes/:id`: the class detail plus the member's own class
 * packages, each Eligible to pay or with the reason it is not, and the Default
 * payer.
 */
export type ApiMemberClassDetail = ApiClassDetail & PickerPayload;

export function fetchMemberClass(api: Api, classId: string): Promise<ApiMemberClassDetail> {
  return api.get<ApiMemberClassDetail>(`/me/classes/${classId}`);
}

/** `GET /public/classes/:id`: the class detail for a visitor who is not signed in. */
export function fetchPublicClass(classId: string): Promise<ApiClassDetail> {
  return publicApi.get<ApiClassDetail>(`/public/classes/${classId}`);
}

/** Whether the signed-in client currently holds something that can pay for a class. */
export function useCanBookClass(): {
  canBook: boolean;
  loaded: boolean;
  entitlements: ClassEntitlements | null;
} {
  const { isLoaded, isSignedIn } = useMemberSession();
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

