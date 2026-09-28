"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** How long a panel takes to slide open or shut (`duration-300` below). */
const SLIDE_MS = 300;
/** Where a newly opened section's first item lands, as a share of the screen's height. */
const FIRST_ITEM_AT = 0.25;

export interface AccordionSection {
  /** Stable across renders; also names the panel's element id. */
  key: string;
  label: string;
  /** Right-hand note on the header, such as "3 classes". */
  summary: string;
}

/**
 * A list of sections with at most one open: the schedule's days, the
 * workshops' months. The first section is open until the member picks another,
 * or again when a filter removes the one they picked. Opening a section closes
 * the one that was open; tapping the open one closes it, leaving none open
 * until the member opens another. The open section's header stays pinned
 * under the top bar while its contents scroll.
 */
export function OneOpenAccordion({
  sections,
  idPrefix,
  children,
}: {
  sections: AccordionSection[];
  idPrefix: string;
  /** A section's contents, rendered for every section and shown for the open one. */
  children: (key: string) => ReactNode;
}) {
  // `undefined` until the member taps a header (the first section is open),
  // `null` once they have closed the open one (none is).
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const openKey =
    picked === null
      ? null
      : sections.some((s) => s.key === picked)
        ? picked!
        : (sections[0]?.key ?? null);

  // Opening a section moves everything around it: the one closing above it
  // pulls it up, and its own contents grow below. Once the slide has settled,
  // scroll so its first item sits a quarter of the way down the screen, where
  // the eye lands, whichever way the page moved. The browser stops short at
  // the foot of the page, so a last short section simply ends at the bottom.
  //
  // Closing a section a member had scrolled deep into leaves its header above
  // the screen once the contents fold away; bring that header back to just
  // under the top bar, so they are where they were in the list.
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const [scrollTo, setScrollTo] = useState<{ key: string; opened: boolean } | null>(null);
  useEffect(() => {
    if (!scrollTo) return;
    const timer = setTimeout(() => {
      const panel = panelRefs.current.get(scrollTo.key);
      setScrollTo(null);
      if (!panel) return;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      if (scrollTo.opened) {
        const off = panel.getBoundingClientRect().top - window.innerHeight * FIRST_ITEM_AT;
        // Its scroll margin (`scroll-mt-[25vh]` below) is the quarter screen.
        if (Math.abs(off) >= 8) panel.scrollIntoView({ block: "start", behavior });
      } else {
        const header = panel.previousElementSibling;
        // Its scroll margin (below) is the top bar and any pinned filter row,
        // which the browser has resolved to px.
        const pinnedAbove = header ? parseFloat(getComputedStyle(header).scrollMarginTop) || 64 : 64;
        if (header && header.getBoundingClientRect().top < pinnedAbove) {
          header.scrollIntoView({ block: "start", behavior });
        }
      }
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [scrollTo]);

  const toggle = (key: string) => {
    const opened = key !== openKey;
    setPicked(opened ? key : null);
    setScrollTo({ key, opened });
  };

  return (
    <div className="flex flex-col gap-2">
      {sections.map(({ key, label, summary }) => {
        const isOpen = key === openKey;
        const panelId = `${idPrefix}-${key}`;
        return (
          <section key={key} aria-label={label}>
            {/* Pinned in the page's own colour so rows slide cleanly beneath it. */}
            <h2
              className={cn(
                "-mx-4 scroll-mt-[calc(var(--top-bar)+var(--filters-h))] px-4 md:mx-0 md:px-0",
                isOpen && "sticky top-[calc(var(--top-bar)+var(--filters-h))] z-10 bg-paper/95 backdrop-blur-sm",
              )}
            >
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className={cn(
                  "flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-bold text-ink",
                  "rounded-xl hover:text-accent",
                )}
              >
                <span>{label}</span>
                <span className="flex items-center gap-2 text-xs font-medium text-muted">
                  {summary}
                  <ChevronDown
                    aria-hidden
                    className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
                  />
                </span>
              </button>
            </h2>
            {/* The panel slides between no height and its own: a grid row
                animating from 0fr to 1fr, so no height is ever measured. A
                closed panel stays mounted, so it can slide shut, and inert,
                so nothing in it takes focus or is read out. */}
            <div
              id={panelId}
              ref={(el) => {
                if (el) panelRefs.current.set(key, el);
                else panelRefs.current.delete(key);
              }}
              inert={!isOpen}
              className={cn(
                "grid scroll-mt-[25vh] transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="pb-3">{children(key)}</div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
