"use client";

import { ViewTransition, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { isAnythingLoading, useAnythingLoading } from "@/lib/loading-store";

/** A hold that never lets go (a stuck read) must not keep the page hidden for good. */
const REVEAL_ANYWAY_AFTER_MS = 10_000;

/**
 * How a page arrives. Used by the route templates (`(client)/template.tsx`,
 * `(client)/account/template.tsx`), which remount on every navigation between
 * their child segments — so switching account tabs animates the panel, not the
 * account menu beside it, and the header and tab bar never move.
 *
 *  - On a navigation the browser's View Transition fades the old page out
 *    (`page` class, `globals.css`). Where it is unsupported the old page simply
 *    goes.
 *  - The new page is held back while it is still reading what it shows
 *    (`ContentLoading`, under the app's one spinner), then arrives whole, once:
 *    `.page-enter` for a page, `.panel-enter` for an account panel inside a page
 *    that is already there. A page never draws its heading and then pops its
 *    rows in under it, and a page whose reads are cached arrives on the first
 *    frame.
 *
 * Revealed once per mount: a later read on the page (a new filter) keeps the
 * page up and loads in place.
 */
export function PageTransition({ children, variant = "page" }: { children: ReactNode; variant?: "page" | "panel" }) {
  const loading = useAnythingLoading();
  const [revealed, setRevealed] = useState(false);

  // Before paint, after the page's own holds have registered (they are layout
  // effects too, and a child's run before its parent's), so a page with
  // nothing to wait for is never drawn hidden for a frame.
  useLayoutEffect(() => {
    if (!revealed && !isAnythingLoading()) setRevealed(true);
  }, [revealed, loading]);

  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setRevealed(true), REVEAL_ANYWAY_AFTER_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  return (
    <ViewTransition exit="page" enter="none" default="none">
      <div
        className={revealed ? (variant === "panel" ? "panel-enter" : "page-enter") : "page-pending"}
        aria-busy={revealed ? undefined : true}
      >
        {children}
      </div>
    </ViewTransition>
  );
}
