"use client";

import { useEffect, useState } from "react";
import { publicApi } from "./api";
import type { CancellationPolicy } from "./cancellation-copy";

export type { CancellationPolicy } from "./cancellation-copy";

/**
 * The studio's cancellation window and cap, read from the backend on each page
 * load. Public, because the schedule is: a member is told the rules before
 * they sign in to book. Not cached across loads — an admin who changes the
 * window should see members told the new one on their next visit.
 *
 * `null` while loading or if the read fails. Callers word around the gap
 * rather than guess a number; the server's refusal stays the enforcement.
 */
export function useCancellationPolicy(): CancellationPolicy | null {
  const [policy, setPolicy] = useState<CancellationPolicy | null>(null);
  useEffect(() => {
    let cancelled = false;
    publicApi
      .get<CancellationPolicy>("/public/cancellation-policy")
      .then((p) => {
        if (!cancelled) setPolicy(p);
      })
      .catch(() => {
        /* stays null — see above */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return policy;
}
