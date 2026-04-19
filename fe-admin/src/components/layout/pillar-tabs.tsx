"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type PillarTab = { href: string; label: string };

export function PillarTabs({ tabs }: { tabs: PillarTab[] }) {
  const pathname = usePathname();
  return (
    <div className="border-b border-ink/10">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "inline-flex items-center border-b-2 px-4 py-2.5 text-sm transition-colors",
                active
                  ? "border-accent text-accent-deep font-medium"
                  : "border-transparent text-ink/60 hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
