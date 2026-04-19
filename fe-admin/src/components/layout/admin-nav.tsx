"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS_ADMIN, NAV_ITEMS_INSTRUCTOR, NAV_ITEMS_SUPER, type NavItem } from "./nav-items";
import { useAdminState } from "@/lib/admin-state";
import { cn } from "@/lib/utils";
import type { AdminRole } from "@/types";

const NAV_MAP: Record<AdminRole, NavItem[]> = {
  admin: NAV_ITEMS_ADMIN,
  instructor: NAV_ITEMS_INSTRUCTOR,
  super: NAV_ITEMS_SUPER,
};

export function AdminNav({ variant }: { variant: AdminRole }) {
  const pathname = usePathname();
  const state = useAdminState((s) => s);
  const items = NAV_MAP[variant];
  const activeHref = pathname ?? "/";

  return (
    <nav className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
      <div className="px-4 pt-5 pb-3 text-sm font-semibold tracking-wide text-ink">Yoga Sadhana</div>
      <ul className="space-y-0.5 px-2 pb-6">
        {items.map((item) => {
          const isActive =
            item.href === "/"
              ? activeHref === "/"
              : activeHref === item.href || activeHref.startsWith(item.href + "/");
          const badge = item.badgeSelector?.(state);
          return (
            <li key={item.href}>
              {item.section && (
                <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {item.section}
                </div>
              )}
              <Link
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-ink hover:bg-paper"
                )}
              >
                <item.icon
                  className={cn("h-4 w-4", isActive ? "text-accent" : "text-muted")}
                />
                <span className="flex-1">{item.label}</span>
                {badge !== undefined && (
                  <span className="inline-flex min-w-[20px] justify-center rounded-full bg-warning/20 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                    {badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
