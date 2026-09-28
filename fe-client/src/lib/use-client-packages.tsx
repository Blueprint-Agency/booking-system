"use client";

import { getMemberToken, useMemberSession } from "@/lib/member-auth";
import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { fetchApi } from "./api-url";
import { reportError } from "./report-error";
import type { UnlimitedPlanCoverage } from "./package-picker";

export interface LivePackage {
  id: string;
  kind: "credit_bundle" | "unlimited" | "pt";
  name: string;
  creditsOrSessionsRemaining: number | null;
  expiresAt: string | null;
  purchasedAt: string;
  amountPaidSgd: string;
  active: boolean;
  /**
   * Backend-derived. Never re-tested here as "no end date". Every package
   * starts Dormant and Activates on the first booking it pays for; any number
   * per family (class / PT) may run at once (be/docs/adr/0010).
   */
  dormant: boolean;
  /** How long a Dormant package runs once it starts; null on an Unlimited Plan. */
  validityDays: number | null;
  /** What this plan paid for its Cross-Location Add-On; null means Home Location only. */
  crossLocationPaidSgd: string | null;
  /** The plan's Home Location; null for every kind but an Unlimited Plan. */
  location: UnlimitedLocation | null;
  sessionType: "1on1" | "2on1" | null;
  /**
   * The instructor this PT package's sessions are with; null means open to any
   * of them. Backend-derived — never re-tested here as "PT and bound".
   */
  boundInstructor: { id: string; name: string } | null;
}

/** The one Location a live Unlimited Plan Covers. Null when there is no live plan. */
export interface UnlimitedLocation {
  id: string;
  name: string;
}

export interface ClientPackagesData {
  classCredits: {
    total: number;
    isUnlimited: boolean;
    unlimitedExpiresAt: string | null;
    unlimitedDormant: boolean;
    unlimitedLocation: UnlimitedLocation | null;
  };
  ptSessions: { oneOnOne: number; twoOnOne: number };
  packages: LivePackage[];
  /** Packages that have run out: expired, or every credit or session used. */
  ended: LivePackage[];
  /** Every live Unlimited Plan, running ones first. Several may be homed at different Locations. */
  unlimitedPlans: UnlimitedPlanCoverage[];
  /** The Cross-Location Add-On, as the backend states it (§5). */
  crossLocation: {
    /** The plan an Add-On would attach to — the same plan `unlimitedLocation` names. */
    planId: string | null;
    /** That plan already Covers both studios. Backend-derived, never re-tested here. */
    coversBoth: boolean;
    rateSgd: string;
  };
}

export interface ClientPackagesValue {
  classCredits: number;
  isUnlimited: boolean;
  unlimitedExpiresAt: string | null;
  /** The member holds a Dormant plan — backend-derived, never re-tested here. */
  unlimitedDormant: boolean;
  unlimitedLocation: UnlimitedLocation | null;
  /** Every live Unlimited Plan, running ones first. */
  unlimitedPlans: UnlimitedPlanCoverage[];
  /** The Cross-Location Add-On, as the backend states it (§5). */
  crossLocation: ClientPackagesData["crossLocation"];
  pt1on1: number;
  pt2on1: number;
  packages: LivePackage[];
  /** Packages that have run out: expired, or every credit or session used. */
  endedPackages: LivePackage[];
  loading: boolean;
  refetch: () => Promise<void>;
}

const ClientPackagesContext = createContext<ClientPackagesValue | null>(null);

// ── BE `/me/packages` wire shape (snake_case) ────────────────────────────────
interface RawClientPackage {
  id: string;
  kind: "credit_bundle" | "unlimited" | "trial" | "pt";
  package_name: string;
  credits_or_sessions_remaining: number | null;
  expires_at: string | null;
  purchased_at: string;
  amount_paid_sgd: string;
  active: boolean;
  dormant: boolean;
  validity_days: number | null;
  cross_location_paid_sgd: string | null;
  unlimited_location: UnlimitedLocation | null;
  session_type: "1on1" | "2on1" | null;
  bound_instructor: { id: string; name: string } | null;
}
interface RawPackagesResponse {
  client_packages: RawClientPackage[];
  entitlements: {
    trial_used: boolean;
    has_active_unlimited: boolean;
    unlimited_location: UnlimitedLocation | null;
    unlimited_plan_id: string | null;
    unlimited_covers_both: boolean;
    unlimited_plans?: UnlimitedPlanCoverage[];
    cross_location_rate_sgd: string;
    dormant: boolean;
    has_active_bundle_credits: boolean;
    pt_1on1_remaining: number;
    pt_2on1_remaining: number;
  };
}

/**
 * Maps the BE `/me/packages` response into the shape the UI consumes.
 * The BE returns snake_case `client_packages` + an `entitlements` summary;
 * the UI wants a class-credit total, a PT-session total, and a camelCase
 * wallet of *active* packages.
 */
function mapPackagesResponse(raw: RawPackagesResponse): ClientPackagesData {
  const pkgs = raw.client_packages ?? [];
  const ent = raw.entitlements ?? {
    trial_used: false,
    has_active_unlimited: false,
    unlimited_location: null,
    unlimited_plan_id: null,
    unlimited_covers_both: false,
    unlimited_plans: [],
    cross_location_rate_sgd: "0.00",
    dormant: false,
    has_active_bundle_credits: false,
    pt_1on1_remaining: 0,
    pt_2on1_remaining: 0,
  };

  // `active` is authoritative; the live expiry check covers the gap between a
  // package ending and the nightly sweep flipping the flag (the BE entitlements
  // make the same allowance). Without it an ended package would still be listed
  // as running.
  const now = Date.now();
  const isActive = (p: RawClientPackage) =>
    p.active && (p.expires_at === null || new Date(p.expires_at).getTime() > now);

  // Class credit total = sum of active credit-bundle + trial credits.
  let classTotal = 0;
  let unlimitedExpiresAt: string | null = null;
  for (const p of pkgs) {
    if (!isActive(p)) continue;
    if (p.kind === "credit_bundle" || p.kind === "trial") {
      classTotal += p.credits_or_sessions_remaining ?? 0;
    } else if (p.kind === "unlimited" && p.expires_at) {
      // Only an Activated plan has a date to show, so a Dormant plan's null never
      // overwrites it. Several plans may run at once; the balance names the last
      // day any of them runs to.
      if (unlimitedExpiresAt === null || new Date(p.expires_at) > new Date(unlimitedExpiresAt)) {
        unlimitedExpiresAt = p.expires_at;
      }
    }
  }

  const toPackage = (p: RawClientPackage): LivePackage => ({
    id: p.id,
    // Trial credits live in the class-credit wallet; surface them as a bundle.
    kind: p.kind === "trial" ? "credit_bundle" : p.kind,
    name: p.package_name,
    creditsOrSessionsRemaining: p.credits_or_sessions_remaining,
    expiresAt: p.expires_at,
    purchasedAt: p.purchased_at,
    amountPaidSgd: p.amount_paid_sgd,
    active: p.active,
    dormant: p.dormant,
    validityDays: p.validity_days ?? null,
    crossLocationPaidSgd: p.cross_location_paid_sgd,
    location: p.unlimited_location ?? null,
    sessionType: p.session_type,
    boundInstructor: p.bound_instructor ?? null,
  });
  const packages = pkgs.filter(isActive).map(toPackage);
  // Expired or used up: the Your packages page lists them under Ended.
  const ended = pkgs.filter((p) => !isActive(p)).map(toPackage);

  return {
    classCredits: {
      total: classTotal,
      isUnlimited: Boolean(ent.has_active_unlimited),
      unlimitedExpiresAt,
      unlimitedDormant: Boolean(ent.dormant),
      unlimitedLocation: ent.unlimited_location ?? null,
    },
    ptSessions: { oneOnOne: ent.pt_1on1_remaining ?? 0, twoOnOne: ent.pt_2on1_remaining ?? 0 },
    packages,
    ended,
    unlimitedPlans: ent.unlimited_plans ?? [],
    crossLocation: {
      planId: ent.unlimited_plan_id ?? null,
      coversBoth: Boolean(ent.unlimited_covers_both),
      rateSgd: ent.cross_location_rate_sgd ?? "0.00",
    },
  };
}

export function ClientPackagesProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded, session } = useMemberSession();
  const userId = session?.userId ?? null;
  const pathname = usePathname();
  const [data, setData] = useState<ClientPackagesData | null>(null);
  // Starts true: on the first paint nothing has been fetched yet, and a consumer
  // that branches on what the member owns (the checkout Home studio picker) must
  // not read "no live plan" out of an empty context and offer the wrong control.
  const [loading, setLoading] = useState(true);
  // Whose packages `data` holds. A re-read for the same member (a route
  // change, a refetch after checkout) keeps them on screen and updates them in
  // place: flipping `loading` back on would swap the page just arrived at back
  // into the spinner and out again.
  const loadedFor = useRef<string | null>(null);
  // Only the latest read may land: an older one answering late would put back
  // what the newer one has already replaced.
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!isSignedIn || !userId) {
      // A read still out for the member who just left must not land after this.
      latest.current++;
      loadedFor.current = null;
      setData(null);
      setLoading(false);
      return;
    }
    const seq = ++latest.current;
    if (loadedFor.current !== userId) setLoading(true);
    try {
      const token = await getMemberToken();
      if (!token) return;

      const res = await fetchApi("/me/packages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // A 401 is an expired session, not a fault: `fetchApi` has already
        // signed the member out, and the pages that need one send them to /login.
        if (res.status !== 401) {
          reportError(new Error(`/me/packages ${res.status}`), {
            scope: "load-packages",
            status: res.status,
          });
        }
        return;
      }
      const mapped = mapPackagesResponse(await res.json());
      if (seq !== latest.current) return;
      loadedFor.current = userId;
      setData(mapped);
    } catch (err) {
      // Non-fatal for the UI (falls back to zero values), but report so it's not silent.
      reportError(err, { scope: "load-packages" });
    } finally {
      if (seq === latest.current) setLoading(false);
    }
  }, [isSignedIn, userId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      latest.current++;
      loadedFor.current = null;
      setData(null);
      setLoading(false);
      return;
    }
    load();
  }, [isLoaded, isSignedIn, userId, load]);

  // Refetch after route changes (e.g. post-checkout confirmation → account).
  // Skips the initial render — the auth effect above already loads on mount,
  // and firing both would issue a duplicate in-flight request.
  const firstPathname = useRef(true);
  useEffect(() => {
    if (firstPathname.current) {
      firstPathname.current = false;
      return;
    }
    if (!isLoaded || !isSignedIn || !userId) return;
    load();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // `refetch` keeps one identity for the life of the provider, always running
  // the latest `load`: consumers key effects on it (the payment return syncs,
  // then refetches), and a new identity when the session resolves would
  // re-run those effects — a second POST of the same payment sync.
  const loadRef = useRef(load);
  loadRef.current = load;
  const refetch = useCallback(() => loadRef.current(), []);

  // One value per change, not per render: every page under the provider reads it.
  const value = useMemo<ClientPackagesValue>(
    () => ({
      classCredits: data?.classCredits?.total ?? 0,
      isUnlimited: data?.classCredits?.isUnlimited ?? false,
      unlimitedExpiresAt: data?.classCredits?.unlimitedExpiresAt ?? null,
      unlimitedDormant: data?.classCredits?.unlimitedDormant ?? false,
      unlimitedLocation: data?.classCredits?.unlimitedLocation ?? null,
      unlimitedPlans: data?.unlimitedPlans ?? [],
      crossLocation: data?.crossLocation ?? { planId: null, coversBoth: false, rateSgd: "0.00" },
      pt1on1: data?.ptSessions?.oneOnOne ?? 0,
      pt2on1: data?.ptSessions?.twoOnOne ?? 0,
      packages: data?.packages ?? [],
      endedPackages: data?.ended ?? [],
      loading,
      refetch,
    }),
    [data, loading, refetch],
  );

  return (
    <ClientPackagesContext.Provider value={value}>
      {children}
    </ClientPackagesContext.Provider>
  );
}

export function useClientPackages(): ClientPackagesValue {
  const ctx = useContext(ClientPackagesContext);
  if (!ctx) {
    throw new Error("useClientPackages must be used within ClientPackagesProvider");
  }
  return ctx;
}
