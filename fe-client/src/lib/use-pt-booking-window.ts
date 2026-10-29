"use client";

import { publicApi } from "./api";
import { fromPtBookingConfig, type PtBookingConfigResponse, type PtBookingWindow } from "./pt-booking-window";
import { useCachedResource } from "./resource-cache";

/**
 * The studio's Book in advance window, read like the cancellation policy
 * (`lib/cancellation-policy.ts`) and re-read quietly on each page that mounts
 * it (`resource-cache.ts`): an admin who changes it should see members told the
 * new one on their next visit.
 *
 * `null` while loading. A failed read is thrown to the page's error state
 * (`failed-read.ts`), not drawn as no window: the window is a studio rule, and
 * a form that states none reads as if any date were allowed, to a member who
 * then proposes dates the studio refuses.
 */
export function usePtBookingWindow(): PtBookingWindow | null {
  const { data } = useCachedResource("public:pt-booking-config", () =>
    publicApi.get<PtBookingConfigResponse>("/public/pt-booking-config").then(fromPtBookingConfig),
  );
  return data;
}
