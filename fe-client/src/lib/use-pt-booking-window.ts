"use client";

import { useEffect, useState } from "react";
import { publicApi } from "./api";
import {
  fromPtBookingConfig,
  type PtBookingConfigResponse,
  type PtBookingWindow,
} from "./pt-booking-window";

/**
 * The studio's Book in advance window, read on each page load like the
 * cancellation policy (`lib/cancellation-policy.ts`): an admin who changes it
 * should see members told the new one on their next visit.
 *
 * `null` while loading or if the read fails. The form then states no window
 * and leaves the dates to the server's refusal rather than guess one.
 */
export function usePtBookingWindow(): PtBookingWindow | null {
  const [bookingWindow, setBookingWindow] = useState<PtBookingWindow | null>(null);
  useEffect(() => {
    let cancelled = false;
    publicApi
      .get<PtBookingConfigResponse>("/public/pt-booking-config")
      .then((r) => {
        if (!cancelled) setBookingWindow(fromPtBookingConfig(r));
      })
      .catch(() => {
        /* stays null — see above */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return bookingWindow;
}
