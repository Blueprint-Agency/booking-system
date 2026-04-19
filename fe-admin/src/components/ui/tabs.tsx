"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type TabItem = { href: string; label: string };

export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <div className={cn("border-b border-border", className)}>
      <nav className="flex gap-6">
        {items.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "pb-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-accent text-accent-deep"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
