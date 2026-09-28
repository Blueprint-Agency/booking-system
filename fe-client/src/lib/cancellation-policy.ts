"use client";

import { publicApi } from "./api";
import { useCachedResource } from "./resource-cache";
import type { CancellationPolicy } from "./cancellation-copy";

export type { CancellationPolicy } from "./cancellation-copy";

/**
 * The studio's cancellation window and cap, read from the backend. Public,
 * because the schedule is: a member is told the rules before they sign in to
 * book. One read shared by every row and sheet that asks, re-read quietly on
 * each page that mounts it (`resource-cache.ts`) — an admin who changes the
 * window has members told the new one on their next page.
 *
 * `null` while loading or if the read fails. Callers word around the gap
 * rather than guess a number; the server's refusal stays the enforcement.
 */
export function useCancellationPolicy(): CancellationPolicy | null {
  return useCancellationPolicyRead().policy;
}

/** The same, with whether the read has settled — for a page that waits for it rather than shift when it lands. */
export function useCancellationPolicyRead(): { policy: CancellationPolicy | null; settled: boolean } {
  const { data, loading, error } = useCachedResource("public:cancellation-policy", () =>
    publicApi.get<CancellationPolicy>("/public/cancellation-policy"),
  );
  return { policy: error ? null : data, settled: !loading };
}
