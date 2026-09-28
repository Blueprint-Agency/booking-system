"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { useMemberSession } from "@/lib/member-auth";
import { reportError } from "@/lib/report-error";
import { cachedValue, useCachedResource } from "@/lib/resource-cache";
import type { PracticeData } from "@/lib/practice";

export type PracticeView = "week" | "month" | "year";

/**
 * The member's practice summary for the week, month or year containing `on`
 * (`GET /me/bookings/attendance`), or the one containing today when `on` is
 * null. Keyed by member, period and day, so a reply that lands after sign-out,
 * for the member signed in before, or for a period the member has since moved
 * off is never drawn.
 *
 *  - `summary` is this key's own answer, null until it has loaded and whenever
 *    nobody is signed in.
 *  - `shown` is what to draw: `summary`, or while the next period loads, the
 *    last one this same member was shown, so the page does not blank between
 *    periods. `pending` says it is standing in.
 */
export function usePractice(
  period: PracticeView,
  on: string | null,
): {
  summary: PracticeData | null;
  shown: PracticeData | null;
  pending: boolean;
  loading: boolean;
  failed: boolean;
  retry: () => Promise<void>;
} {
  const api = useApi();
  const { session } = useMemberSession();
  const member = session?.userId ?? null;
  const key = member ? `me:${member}:practice:${period}:${on ?? "now"}` : null;
  const read = useCachedResource<PracticeData>(key, async () => {
    try {
      return await api.get<PracticeData>("/me/bookings/attendance", on ? { period, on } : { period });
    } catch (err) {
      reportError(err, { scope: "practice" });
      throw err;
    }
  });
  // Until this key has its own answer, `read.data` may still be the last key's
  // (possibly another member's): it is never drawn as this key's.
  const loaded = key !== null && cachedValue<PracticeData>(key) !== undefined;
  const summary = loaded ? read.data : null;

  // The last answer drawn, and whose, kept as the stand-in while the next loads.
  const [last, setLast] = useState<{ member: string; data: PracticeData } | null>(null);
  if (summary && member && (last?.data !== summary || last.member !== member)) setLast({ member, data: summary });
  if (!member && last) setLast(null);
  const standIn = member && last?.member === member ? last.data : null;

  return {
    summary,
    shown: summary ?? standIn,
    pending: key !== null && !loaded,
    loading: key !== null && read.loading,
    failed: key !== null && !loaded && read.error !== null,
    retry: read.refresh,
  };
}
