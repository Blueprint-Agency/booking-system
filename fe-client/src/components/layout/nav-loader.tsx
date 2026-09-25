"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type State = "idle" | "loading" | "done";

/** A navigation that answers faster than this shows no bar at all. */
const SHOW_AFTER_MS = 120;
/** A click that has not changed the page by now is not going to. */
const GIVE_UP_AFTER_MS = 15_000;

/**
 * A thin accent bar across the top while the next page loads, so a tap on a
 * slow connection visibly did something. Styles: `.nav-progress` in
 * `globals.css`.
 *
 * It starts on a click on an in-app link to another page and completes when
 * the pathname changes. Modified clicks, new tabs, downloads and links off
 * this site are left alone — the browser shows its own progress for those.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<State>("idle");
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    // Capture phase: `next/link` cancels the click's default (and routes itself)
    // in React's handler on `document`, which runs before any bubble listener
    // added here — so a bubble listener would see every in-app link as cancelled.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!(a instanceof HTMLAnchorElement) || !a.href || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      pending.current = true;
      if (showTimer.current) clearTimeout(showTimer.current);
      showTimer.current = setTimeout(() => {
        if (pending.current) setState("loading");
      }, SHOW_AFTER_MS);
      // A link whose own handler cancels the navigation never changes the
      // pathname: don't leave the bar hanging for it.
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
      giveUpTimer.current = setTimeout(() => {
        pending.current = false;
        setState((s) => (s === "loading" ? "done" : s));
      }, GIVE_UP_AFTER_MS);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (showTimer.current) clearTimeout(showTimer.current);
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    };
  }, []);

  // The new page is here: finish the bar if it was showing, and forget the start
  // if it never got that far.
  useEffect(() => {
    pending.current = false;
    if (showTimer.current) clearTimeout(showTimer.current);
    if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    setState((s) => (s === "loading" ? "done" : s));
  }, [pathname]);

  useEffect(() => {
    if (state !== "done") return;
    const t = setTimeout(() => setState("idle"), 500);
    return () => clearTimeout(t);
  }, [state]);

  return <div className="nav-progress" data-state={state} aria-hidden />;
}
