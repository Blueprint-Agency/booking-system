"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEMS } from "./app-nav-items";

export function SideRail() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:flex-col md:w-56 shrink-0 border-r border-border bg-paper">
      <nav className="flex flex-col gap-1 p-3 sticky top-16">
        {APP_NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors",
                active ? "text-accent-deep bg-accent/10" : "text-muted hover:text-ink hover:bg-warm",
              )}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
