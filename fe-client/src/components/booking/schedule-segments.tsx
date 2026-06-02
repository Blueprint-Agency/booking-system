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
    <div className="inline-flex items-center rounded-full bg-warm border border-ink/10 p-1 mb-6">
      {SEGMENTS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "px-4 py-1.5 text-sm font-semibold rounded-full transition-colors",
            isActive(href) ? "bg-paper text-accent-deep shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
