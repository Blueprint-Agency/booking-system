"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False on the server and on the render that hydrates the server's HTML; true
 * on every render after it, and at once for a component first mounted after
 * hydration (a client-side navigation), so a visited page never flashes.
 *
 * A value only the browser holds — a token in `localStorage`, a store that has
 * already settled, the clock, the browser's locale — must not change what the
 * hydrating render draws, or React throws the server's HTML away. Gate it on
 * this; `memberSessionView` (lib/member-session-view.ts) is the worked case,
 * and docs/md/research-nextjs-hydration-and-errors.md the rules.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
