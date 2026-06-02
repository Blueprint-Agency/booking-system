"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { getApiBaseUrl } from "./api-url";

export interface LivePackage {
  id: string;
  kind: "credit_bundle" | "unlimited" | "pt";
  name: string;
  creditsOrSessionsRemaining: number | null;
  expiresAt: string | null;
  purchasedAt: string;
  amountPaidSgd: string;
}

export interface ClientPackagesData {
  classCredits: {
    total: number;
    isUnlimited: boolean;
    unlimitedExpiresAt: string | null;
  };
  ptSessions: { total: number };
  packages: LivePackage[];
}

export interface ClientPackagesValue {
  classCredits: number;
  isUnlimited: boolean;
  unlimitedExpiresAt: string | null;
  ptSessions: number;
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
}
interface RawPackagesResponse {
  client_packages: RawClientPackage[];
  entitlements: {
    trial_used: boolean;
    has_active_unlimited: boolean;
    has_active_bundle_credits: boolean;
    pt_sessions_remaining: number;
  };
}

/**
 * Maps the BE `/me/packages` response into the shape the UI consumes.
 * The BE returns snake_case `client_packages` + an `entitlements` summary;
 * the UI wants a class-credit total, a PT-session total, and a camelCase
 * wallet of *active* packages.
 */
function mapPackagesResponse(raw: RawPackagesResponse): ClientPackagesData {
  const now = Date.now();
  const pkgs = raw.client_packages ?? [];
  const ent = raw.entitlements ?? {
    trial_used: false,
    has_active_unlimited: false,
    has_active_bundle_credits: false,
    pt_sessions_remaining: 0,
  };

  const notExpired = (p: RawClientPackage) =>
    p.expires_at === null || new Date(p.expires_at).getTime() > now;
  const isActive = (p: RawClientPackage) => {
    if (!notExpired(p)) return false;
    if (p.kind === "unlimited") return true;
    return (p.credits_or_sessions_remaining ?? 0) > 0;
  };

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
    }));

  return {
    classCredits: {
      total: classTotal,
      isUnlimited: Boolean(ent.has_active_unlimited),
      unlimitedExpiresAt,
    },
    ptSessions: { total: ent.pt_sessions_remaining ?? 0 },
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
      if (!res.ok) return;
      setData(mapPackagesResponse(await res.json()));
    } catch {
      // Non-fatal — UI falls back to zero values
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

  // Refetch after route changes (e.g. post-checkout confirmation → account)
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    load();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: ClientPackagesValue = {
    classCredits: data?.classCredits?.total ?? 0,
    isUnlimited: data?.classCredits?.isUnlimited ?? false,
    unlimitedExpiresAt: data?.classCredits?.unlimitedExpiresAt ?? null,
    ptSessions: data?.ptSessions?.total ?? 0,
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
