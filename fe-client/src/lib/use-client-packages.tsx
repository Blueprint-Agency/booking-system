"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { getApiBaseUrl } from "./api-url";
import { reportError } from "./report-error";

export interface LivePackage {
  id: string;
  kind: "credit_bundle" | "unlimited" | "pt";
  name: string;
  creditsOrSessionsRemaining: number | null;
  expiresAt: string | null;
  purchasedAt: string;
  amountPaidSgd: string;
  active: boolean;
  sessionType: "1on1" | "2on1" | null;
}

export interface ClientPackagesData {
  classCredits: {
    total: number;
    isUnlimited: boolean;
    unlimitedExpiresAt: string | null;
  };
  ptSessions: { oneOnOne: number; twoOnOne: number };
  packages: LivePackage[];
}

export interface ClientPackagesValue {
  classCredits: number;
  isUnlimited: boolean;
  unlimitedExpiresAt: string | null;
  pt1on1: number;
  pt2on1: number;
  packages: LivePackage[];
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
  session_type: "1on1" | "2on1" | null;
}
interface RawPackagesResponse {
  client_packages: RawClientPackage[];
  entitlements: {
    trial_used: boolean;
    has_active_unlimited: boolean;
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
    has_active_bundle_credits: false,
    pt_1on1_remaining: 0,
    pt_2on1_remaining: 0,
  };

  const isActive = (p: RawClientPackage) => p.active;

  // Class credit total = sum of active credit-bundle + trial credits.
  let classTotal = 0;
  let unlimitedExpiresAt: string | null = null;
  for (const p of pkgs) {
    if (!isActive(p)) continue;
    if (p.kind === "credit_bundle" || p.kind === "trial") {
      classTotal += p.credits_or_sessions_remaining ?? 0;
    } else if (p.kind === "unlimited") {
      unlimitedExpiresAt = p.expires_at;
    }
  }

  const packages: LivePackage[] = pkgs
    .filter(isActive)
    .map((p) => ({
      id: p.id,
      // Trial credits live in the class-credit wallet; surface them as a bundle.
      kind: p.kind === "trial" ? "credit_bundle" : p.kind,
      name: p.package_name,
      creditsOrSessionsRemaining: p.credits_or_sessions_remaining,
      expiresAt: p.expires_at,
      purchasedAt: p.purchased_at,
      amountPaidSgd: p.amount_paid_sgd,
      active: p.active,
      sessionType: p.session_type,
    }));

  return {
    classCredits: {
      total: classTotal,
      isUnlimited: Boolean(ent.has_active_unlimited),
      unlimitedExpiresAt,
    },
    ptSessions: { oneOnOne: ent.pt_1on1_remaining ?? 0, twoOnOne: ent.pt_2on1_remaining ?? 0 },
    packages,
  };
}

async function getAuthToken(getToken: () => Promise<string | null>) {
  let token = await getToken();
  if (!token) {
    await new Promise((r) => setTimeout(r, 150));
    token = await getToken();
  }
  return token;
}

export function ClientPackagesProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn, isLoaded, userId } = useAuth();
  const pathname = usePathname();
  const [data, setData] = useState<ClientPackagesData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isSignedIn || !userId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const token = await getAuthToken(getToken);
      if (!token) return;

      const res = await fetch(`${getApiBaseUrl()}/me/packages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        reportError(new Error(`/me/packages ${res.status}`), {
          scope: "load-packages",
          status: res.status,
        });
        return;
      }
      setData(mapPackagesResponse(await res.json()));
    } catch (err) {
      // Non-fatal for the UI (falls back to zero values), but report so it's not silent.
      reportError(err, { scope: "load-packages" });
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, userId, getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setData(null);
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

  const value: ClientPackagesValue = {
    classCredits: data?.classCredits?.total ?? 0,
    isUnlimited: data?.classCredits?.isUnlimited ?? false,
    unlimitedExpiresAt: data?.classCredits?.unlimitedExpiresAt ?? null,
    pt1on1: data?.ptSessions?.oneOnOne ?? 0,
    pt2on1: data?.ptSessions?.twoOnOne ?? 0,
    packages: data?.packages ?? [],
    loading,
    refetch: load,
  };

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
