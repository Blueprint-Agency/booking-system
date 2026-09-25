"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SEGMENTS = [
  { href: "/", label: "Group classes" },
  { href: "/private-sessions", label: "Private sessions" },
];

export function ScheduleSegments({ className }: { className?: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    // Two equal halves across the phone width — both labels fit at 320px, so
    // nothing scrolls — and a hugging pill once there is room. Drawn like the
    // account's `SegmentedTabs`, but these are links: each half is a page.
    <nav aria-label="Schedule" className={cn("mb-5", className)}>
      <div className="grid grid-cols-2 rounded-full bg-ink/5 p-1 sm:inline-grid sm:w-auto">
        {SEGMENTS.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-full px-4 sm:px-5 text-sm font-semibold transition-colors",
                active ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
