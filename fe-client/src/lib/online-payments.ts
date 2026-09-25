"use client";

import { useEffect, useState } from "react";
import { publicApi } from "./api";

export { NO_ONLINE_PAYMENTS, blockedByPayments } from "./online-payments-rule";

/**
 * Whether this studio takes card payments online at all (#293), read from the
 * backend on each page load. Public, because the catalogue is: a signed-out
 * visitor sees the same buy buttons.
 *
 * `null` while loading or if the read fails — see `blockedByPayments`, which
 * never blocks on an unknown.
 */
export function useOnlinePayments(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    publicApi
      .get<{ online_payments: boolean }>("/public/online-payments")
      .then((res) => {
        if (!cancelled) setOnline(Boolean(res.online_payments));
      })
      .catch(() => {
        /* stays null — see above */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return online;
}
