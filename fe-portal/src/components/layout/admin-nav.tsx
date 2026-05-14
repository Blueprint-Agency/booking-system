"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { createPortal } from "react-dom";
import { NAV_ITEMS, NAV_GROUP_ORDER, type NavItem, type NavGroup } from "./nav-items";
import { inboxItems, ptRequests } from "@/data";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

function getBadge(key: NavItem["badgeKey"]): number | undefined {
  if (key === "inboxUnread") {
    const n = inboxItems.filter((i) => i.readAt === null).length;
    return n > 0 ? n : undefined;
  }
  if (key === "ptRequestsPending") {
    const n = ptRequests.filter((r) => r.status === "pending").length;
    return n > 0 ? n : undefined;
  }
  return undefined;
}

function NavBrand() {
  return (
    <Link
      href="/admin/schedule"
      className="flex items-center gap-2 px-5 pt-5 pb-2 text-sm font-semibold tracking-wide text-ink hover:text-accent"
    >
      <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[11px] font-bold text-white">
        YS
      </span>
      Yoga Sadhana
    </Link>
  );
}

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { role } = useWorkspace();
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.scope === "both") return true;
    if (role === "superadmin") return true; // superadmin sees everything
    return item.scope === "workspace"; // admin sees workspace + both
  });
  const groupedItems: Record<NavGroup, NavItem[]> = NAV_GROUP_ORDER.reduce(
    (acc, group) => {
      acc[group] = visibleItems.filter((i) => i.group === group);
      return acc;
    },
    {} as Record<NavGroup, NavItem[]>
  );

  return (
    <div className="px-2 pt-2 pb-6">
      {NAV_GROUP_ORDER.map((group) => {
        const items = groupedItems[group];
        if (items.length === 0) return null; // hide empty groups for admin
        return (
        <div key={group} className="mb-3">
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            {group}
          </div>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              const badge = getBadge(item.badgeKey);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-accent/10 font-medium text-accent"
                        : "text-ink hover:bg-paper"
                    )}
                  >
                    <item.icon
                      className={cn("h-4 w-4 shrink-0", isActive ? "text-accent" : "text-muted")}
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
        );
      })}
    </div>
  );
}

export function AdminNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
      <NavBrand />
      <NavContent pathname={pathname} />
    </nav>
  );
}

export function AdminMobileNavTrigger() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-paper lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 lg:hidden">
              <div
                className="absolute inset-0 bg-overlay animate-fade-in"
                onClick={() => setOpen(false)}
                aria-hidden="true"
              />
              <aside
                role="dialog"
                aria-modal="true"
                className="absolute left-0 top-0 bottom-0 flex w-[280px] max-w-[85vw] flex-col bg-card shadow-modal"
              >
                <div className="flex items-center justify-between border-b border-border pr-2">
                  <NavBrand />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close menu"
                    className="rounded-md p-2 text-muted hover:bg-paper hover:text-ink"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <NavContent pathname={pathname} onNavigate={() => setOpen(false)} />
                </div>
              </aside>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
