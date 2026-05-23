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
      setData(await res.json());
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
    classCredits: data?.classCredits.total ?? 0,
    isUnlimited: data?.classCredits.isUnlimited ?? false,
    unlimitedExpiresAt: data?.classCredits.unlimitedExpiresAt ?? null,
    ptSessions: data?.ptSessions.total ?? 0,
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
