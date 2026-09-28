"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * How many parts of the page are waiting on data right now. The app shows one
 * centred spinner (`AppLoader`) while this is above zero, however many sections
 * are loading at once — never a spinner per section, and never skeletons.
 */
let holds = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether anything on the page is loading. */
export function useAnythingLoading(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => holds > 0,
    () => false,
  );
}

/** The same, read now — for an effect that must see holds registered this commit. */
export function isAnythingLoading(): boolean {
  return holds > 0;
}

/**
 * Keep the spinner up while `active` is true and this component is mounted.
 * A layout effect, so the hold is registered before the page is painted and
 * before `PageTransition` decides whether the page has anything to wait for.
 */
export function useHoldLoader(active = true): void {
  useLayoutEffect(() => {
    if (!active) return;
    holds += 1;
    emit();
    return () => {
      holds -= 1;
      emit();
    };
  }, [active]);
}
