"use client";

import { useEffect, useRef } from "react";

/** The active traps, innermost last: only the top one handles Tab. */
const traps: HTMLElement[] = [];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus inside the referenced element while `active` is true.
 * Moves focus into the element on activation and restores it to the
 * previously focused element on deactivation/unmount.
 *
 * Usage: `const ref = useFocusTrap<HTMLDivElement>(open)` → spread onto the
 * dialog container (give it `tabIndex={-1}` so it can take fallback focus).
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      );

    (focusables()[0] ?? node).focus();
    traps.push(node);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // A dialog opened over this one (each is portalled on its own) owns Tab
      // until it closes; two traps would each pull focus back to themselves.
      if (traps[traps.length - 1] !== node) return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || !node.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !node.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const at = traps.lastIndexOf(node);
      if (at !== -1) traps.splice(at, 1);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
