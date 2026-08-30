"use client";

import { useEffect } from "react";

/**
 * Freezes the page behind an open overlay.
 *
 * On a phone the modal fills the screen, so a scroll gesture that misses the
 * panel scrolls the page underneath it — the member loses their place in the
 * schedule while a dialog is up. Locking `body` for as long as the overlay is
 * open keeps the position they came from.
 *
 * Nested overlays are safe: the second lock reads the already-hidden value and
 * restores it, so only the outermost unlock puts scrolling back.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
