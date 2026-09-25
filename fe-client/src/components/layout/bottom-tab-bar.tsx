"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEMS } from "./app-nav-items";

export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-card/95 backdrop-blur-md border-t border-ink/5"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {/* One column per item, always a single row: the count comes from the
          list, so adding a tab can never wrap one onto a second line. */}
      <ul
        className="grid h-16"
        style={{ gridTemplateColumns: `repeat(${APP_NAV_ITEMS.length}, minmax(0, 1fr))` }}
      >
        {APP_NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition-colors",
                  active ? "text-accent-deep" : "text-muted hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active ? "bg-accent/12" : "group-hover:bg-ink/5",
                  )}
                >
                  <Icon size={20} strokeWidth={active ? 2.3 : 1.8} />
                </span>
                <span className="max-w-full truncate leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
