"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, NAV_GROUP_ORDER, type NavItem, type NavGroup } from "./nav-items";
import { inboxItems } from "@/data";
import { cn } from "@/lib/utils";

const groupedItems: Record<NavGroup, NavItem[]> = NAV_GROUP_ORDER.reduce(
  (acc, group) => {
    acc[group] = NAV_ITEMS.filter((i) => i.group === group);
    return acc;
  },
  {} as Record<NavGroup, NavItem[]>
);

function getBadge(key: NavItem["badgeKey"]): number | undefined {
  if (key === "inboxUnread") {
    const n = inboxItems.filter((i) => i.readAt === null).length;
    return n > 0 ? n : undefined;
  }
  return undefined;
}

export function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
      <Link
        href="/admin/schedule"
        className="flex items-center gap-2 px-5 pt-5 pb-2 text-sm font-semibold tracking-wide text-ink hover:text-accent"
      >
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[11px] font-bold text-white">
          YS
        </span>
        Yoga Sadhana
      </Link>
      <div className="px-2 pt-2 pb-6">
        {NAV_GROUP_ORDER.map((group) => (
          <div key={group} className="mb-3">
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {group}
            </div>
            <ul className="space-y-0.5">
              {groupedItems[group].map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const badge = getBadge(item.badgeKey);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
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
          </div>
        ))}
      </div>
    </nav>
  );
}
