"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A page's filter row, pinned under the top bar once the page scrolls past it,
 * so a member deep in a list can change what it shows without scrolling back up.
 *
 * Pinned in the page's own colour, bled to the phone gutter, as the open day
 * header is (`one-open-accordion.tsx`); the hairline only shows once it is
 * pinned, where there is something scrolling beneath it to separate. Its height
 * is published as `--filters-h` while it is mounted, so a header pinned on the
 * same page sits beneath it rather than under it (`globals.css`).
 */
export function StickyFilters({ children, className }: { children: React.ReactNode; className?: string }) {
  const barRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--filters-h", `${bar.offsetHeight}px`);
    publish();
    const resize = new ResizeObserver(publish);
    resize.observe(bar);
    return () => {
      resize.disconnect();
      root.style.removeProperty("--filters-h");
    };
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const bar = barRef.current;
    if (!sentinel || !bar) return;
    // Pinned once the spot the bar sat in has scrolled up under the top bar —
    // read off the bar's own `top`, which the browser has resolved to px.
    const topBar = parseFloat(getComputedStyle(bar).top) || 64;
    const seen = new IntersectionObserver(
      ([entry]) => setPinned(!entry!.isIntersecting && entry!.boundingClientRect.top < topBar),
      { rootMargin: `-${topBar}px 0px 0px 0px` },
    );
    seen.observe(sentinel);
    return () => seen.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px -mb-px" />
      <div
        ref={barRef}
        className={cn(
          "sticky top-[var(--top-bar)] z-30 -mx-4 px-4 py-2 md:mx-0 md:px-0",
          "bg-paper/95 backdrop-blur-sm border-b transition-colors",
          pinned ? "border-border" : "border-transparent",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
