"use client";

import { publicApi } from "./api";
import { useCachedResource } from "./resource-cache";

export { NO_ONLINE_PAYMENTS, blockedByPayments } from "./online-payments-rule";

/**
 * Whether this studio takes card payments online at all (#293). Public,
 * because the catalogue is: a signed-out visitor sees the same buy buttons.
 * One read shared by every button that asks, re-read quietly on each page
 * that mounts it (`resource-cache.ts`).
 *
 * `null` while loading or if the read fails — see `blockedByPayments`, which
 * never blocks on an unknown.
 */
export function useOnlinePayments(): boolean | null {
  const { data, error } = useCachedResource("public:online-payments", () =>
    publicApi
      .get<{ online_payments: boolean }>("/public/online-payments")
      .then((res) => Boolean(res.online_payments)),
  );
  return error ? null : data;
}
