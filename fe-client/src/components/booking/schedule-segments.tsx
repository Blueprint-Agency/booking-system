"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SEGMENTS = [
  { href: "/", label: "Group Classes" },
  { href: "/private-sessions", label: "Private Sessions" },
];

export function ScheduleSegments() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    // Both labels together are a few pixels wider than a 320px card, so the
    // pill scrolls instead of pushing the page sideways.
    <div className="-mx-6 mb-6 overflow-x-auto no-scrollbar sm:mx-0">
      <div className="mx-6 inline-flex w-max items-center rounded-full bg-warm border border-ink/10 p-1 sm:mx-0">
        {SEGMENTS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "whitespace-nowrap px-4 py-1.5 text-sm font-semibold rounded-full transition-colors",
              isActive(href) ? "bg-paper text-accent-deep shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
