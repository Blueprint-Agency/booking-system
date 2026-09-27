"use client";

import { useEffect } from "react";
import { isSkippedViewTransition } from "@/lib/view-transition-noise";

/**
 * Stops a skipped page animation from being reported as an uncaught error
 * (`lib/view-transition-noise.ts`). React reports it through the window's
 * `error` event. This listener runs in the capture phase, so it sees the event
 * before the dev overlay and telemetry do, and it stops only that one error.
 * Renders nothing.
 */
export function ViewTransitionGuard() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!isSkippedViewTransition(event.error)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("error", onError, { capture: true });
    return () => window.removeEventListener("error", onError, { capture: true });
  }, []);
  return null;
}
