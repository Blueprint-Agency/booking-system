"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PageLoader } from "@/components/layout/page-loader";
import { useAnythingLoading } from "@/lib/loading-store";

/** A wait shorter than this shows no spinner at all. */
const SHOW_AFTER_MS = 120;
/** A click that has not changed the page by now is not going to. */
const GIVE_UP_AFTER_MS = 15_000;

/**
 * The member app's one loading indicator: the centred spinner (`PageLoader`).
 * It shows while either
 *
 *  - a navigation is on its way: from a click on an in-app link to another
 *    page until the pathname changes. Modified clicks, new tabs, downloads and
 *    links off this site are left alone — the browser shows its own progress;
 *  - any part of the page is waiting on data (`ContentLoading`, via
 *    `lib/loading-store.ts`).
 *
 * A navigation that lands on a page still fetching hands straight over, so the
 * spinner stays up rather than blinking off and on between the two.
 */
export function AppLoader() {
  const pathname = usePathname();
  const contentLoading = useAnythingLoading();
  const [navLoading, setNavLoading] = useState(false);
  const [contentShown, setContentShown] = useState(false);
  const shown = navLoading || contentShown;
  const shownRef = useRef(shown);
  shownRef.current = shown;

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
        if (pending.current) setNavLoading(true);
      }, SHOW_AFTER_MS);
      // A link whose own handler cancels the navigation never changes the
      // pathname: don't leave the spinner hanging for it.
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
      giveUpTimer.current = setTimeout(() => {
        pending.current = false;
        setNavLoading(false);
      }, GIVE_UP_AFTER_MS);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (showTimer.current) clearTimeout(showTimer.current);
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    };
  }, []);

  // The new page is here: the navigation's part is over. Let go a tick late:
  // this effect runs before the new page's own `ContentLoading` holds register
  // (it sits ahead of the page in the tree), so dropping the spinner now would
  // leave it down when they arrive, and they would wait out `SHOW_AFTER_MS`
  // before raising it again — a blink off and on instead of a handover.
  useEffect(() => {
    pending.current = false;
    if (showTimer.current) clearTimeout(showTimer.current);
    if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    const t = setTimeout(() => setNavLoading(false), 0);
    return () => clearTimeout(t);
  }, [pathname]);

  // Content waiting on data: straight away if the spinner is already up (a
  // navigation handing over), otherwise only once the wait is long enough to see.
  useEffect(() => {
    if (!contentLoading) {
      setContentShown(false);
      return;
    }
    if (shownRef.current) {
      setContentShown(true);
      return;
    }
    const t = setTimeout(() => setContentShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [contentLoading]);

  return <PageLoader state={shown ? "loading" : "idle"} />;
}
