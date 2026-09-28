"use client";

import { useApi } from "@/lib/api";
import { useMemberSession } from "@/lib/member-auth";
import { reportError } from "@/lib/report-error";
import { cachedValue, useCachedResource } from "@/lib/resource-cache";
import type { PracticeData } from "@/lib/practice";

/**
 * This month's practice summary (`GET /me/bookings/attendance?period=month`),
 * read once for My practice and the overview line both. Keyed by member, so a
 * reply that lands after sign-out, or for the member signed in before, is
 * dropped; `summary` is null until this member's own has loaded, and whenever
 * nobody is signed in.
 */
export function usePracticeMonth(): {
  summary: PracticeData | null;
  loading: boolean;
  failed: boolean;
  retry: () => Promise<void>;
} {
  const api = useApi();
  const { session } = useMemberSession();
  const key = session ? `me:${session.userId}:practice:month` : null;
  const read = useCachedResource<PracticeData>(key, async () => {
    try {
      return await api.get<PracticeData>("/me/bookings/attendance", { period: "month" });
    } catch (err) {
      reportError(err, { scope: "practice" });
      throw err;
    }
  });
  // Until this key has its own answer, `read.data` may still be the last key's
  // (another member's): it is never drawn.
  const loaded = key !== null && cachedValue<PracticeData>(key) !== undefined;
  return {
    summary: loaded ? read.data : null,
    loading: key !== null && read.loading,
    failed: key !== null && !loaded && read.error !== null,
    retry: read.refresh,
  };
}
