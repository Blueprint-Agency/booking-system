"use client";

import { useEffect } from "react";

/** How many overlays hold the lock, and what the page's body said before the first. */
let locks = 0;
let saved = { overflow: "", paddingRight: "" };

/**
 * Freezes the page behind an open overlay.
 *
 * On a phone the modal fills the screen, so a scroll gesture that misses the
 * panel scrolls the page underneath it — the member loses their place in the
 * schedule while a dialog is up. Locking `body` for as long as the overlay is
 * open keeps the position they came from.
 *
 *  - **Counted**, so overlays may open and close in any order: the page
 *    scrolls again only when the last one lets go.
 *  - **No shift.** Where the scrollbar takes room (a desktop with classic
 *    scrollbars), hiding it would slide the whole page sideways by its width;
 *    the body is padded by that width while locked instead.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (locks++ === 0) {
      const body = document.body;
      saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    }
    return () => {
      if (--locks === 0) {
        document.body.style.overflow = saved.overflow;
        document.body.style.paddingRight = saved.paddingRight;
      }
    };
  }, [active]);
}
