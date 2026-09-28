"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

/** Where the browser's Back / Forward last went: it restores its own scroll position there. */
let poppedTo: string | null = null;

/**
 * A new page opens at its top. Before paint, so the new page is never drawn
 * for a frame at the old one's scroll position and then jumps.
 *
 * Not on Back / Forward: there the browser puts the member back where they
 * were on that page, and sending them to the top would lose their place.
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    const onPop = () => {
      poppedTo = window.location.pathname;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useLayoutEffect(() => {
    const popped = poppedTo === pathname;
    poppedTo = null;
    if (popped) return;
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}
