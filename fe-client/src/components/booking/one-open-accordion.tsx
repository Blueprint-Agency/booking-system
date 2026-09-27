"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** How long a panel takes to slide open or shut (`duration-300` below). */
const SLIDE_MS = 300;

export interface AccordionSection {
  /** Stable across renders; also names the panel's element id. */
  key: string;
  label: string;
  /** Right-hand note on the header, such as "3 classes". */
  summary: string;
}

/**
 * A list of sections with one open at a time: the schedule's days, the
 * workshops' months. The first section is open until the member picks another,
 * or again when a filter removes the one they picked. Opening a section closes
 * the one that was open, and the open section's header stays pinned under the
 * top bar while its contents scroll.
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
  const [picked, setPicked] = useState<string | null>(null);
  const openKey = sections.some((s) => s.key === picked) ? picked : (sections[0]?.key ?? null);

  // Opening a section collapses the one above it, which pulls the new header
  // up the page; bring it back into view once the slide has finished.
  const headerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollTo) return;
    const timer = setTimeout(() => {
      const el = headerRefs.current.get(scrollTo);
      if (el && el.getBoundingClientRect().top < 64) {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      setScrollTo(null);
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [scrollTo]);

  const open = (key: string) => {
    if (key === openKey) return;
    setPicked(key);
    setScrollTo(key);
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
                "-mx-4 px-4 md:mx-0 md:px-0",
                isOpen && "sticky top-16 z-10 bg-paper/95 backdrop-blur-sm",
              )}
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) headerRefs.current.set(key, el);
                  else headerRefs.current.delete(key);
                }}
                onClick={() => open(key)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className={cn(
                  // Scrolled to below the 4rem top bar, where it pins.
                  "flex w-full scroll-mt-16 items-center justify-between gap-3 py-3 text-left text-sm font-bold text-ink",
                  isOpen ? "cursor-default" : "rounded-xl hover:text-accent",
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
              inert={!isOpen}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
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
