"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, MapPin, Settings, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { NAV_ITEMS, NAV_GROUP_ORDER, type NavItem, type NavGroup } from "./nav-items";
import { inboxItems } from "@/data";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

type BadgeMap = Partial<Record<NonNullable<NavItem["badgeKey"]>, number | undefined>>;

function NavBrand() {
  return (
    <Link
      href="/admin/schedule"
      className="group flex items-center gap-2.5 px-4 py-4 text-sm font-semibold tracking-tight text-ink"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-deep text-[11px] font-bold text-white shadow-sm transition-transform group-hover:scale-105">
        YS
      </span>
      <span className="group-hover:text-accent">Yoga Sadhana</span>
    </Link>
  );
}

function NavLinkList({
  items,
  pathname,
  onNavigate,
  onAccent,
  staggered,
  badges,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  /** Rendered on an accent-tinted surface (the location band) — tweak hover/active for contrast. */
  onAccent?: boolean;
  /** Cascade each row in with a slide (used in the keyed location zone on workspace switch). */
  staggered?: boolean;
  badges?: BadgeMap;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, idx) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
        return (
          <li
            key={item.href}
            className={staggered ? "animate-slide-in-left" : undefined}
            style={staggered ? { animationDelay: `${idx * 45}ms` } : undefined}
          >
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                isActive
                  ? "bg-accent/10 font-medium text-accent"
                  : onAccent
                  ? "text-ink/75 hover:bg-accent/[0.08] hover:text-ink"
                  : "text-ink/90 hover:bg-warm/70 hover:text-ink"
              )}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
                />
              )}
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-colors",
                  isActive ? "text-accent" : "text-muted group-hover:text-ink"
                )}
              />
              <span className="flex-1 truncate">{item.label}</span>
              {badge !== undefined && (
                <span
                  className={cn(
                    "inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    isActive ? "bg-accent/15 text-accent" : "bg-warning/20 text-warning"
                  )}
                >
                  {badge}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CollapsibleNavGroup({
  label,
  items,
  pathname,
  onNavigate,
  badges,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  badges?: BadgeMap;
}) {
  const hasActiveChild = items.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/")
  );
  const [open, setOpen] = useState(hasActiveChild);
  // Auto-open when navigating into one of its children.
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
          hasActiveChild ? "font-medium text-ink" : "text-ink/90 hover:bg-warm/70 hover:text-ink"
        )}
      >
        <Settings
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors",
            hasActiveChild ? "text-accent" : "text-muted group-hover:text-ink"
          )}
        />
        <span className="flex-1 text-left font-medium">{label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted transition-transform duration-200",
            open ? "" : "-rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="ml-[18px] mt-0.5 border-l border-border/70 pl-2">
          <NavLinkList items={items} pathname={pathname} onNavigate={onNavigate} badges={badges} />
        </div>
      )}
    </div>
  );
}

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { role, activeLocationId, accessibleLocations, api } = useWorkspace();

  // Live, workspace-scoped count of PENDING PT requests for the nav badge.
  const [ptPending, setPtPending] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!api || !activeLocationId) {
      setPtPending(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ pt_requests: unknown[] }>(
          "/portal/admin/pt-sessions",
          { status: "pending", location_id: activeLocationId },
        );
        if (!cancelled) setPtPending(res.pt_requests?.length || undefined);
      } catch {
        if (!cancelled) setPtPending(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-count when the workspace changes or the route changes (e.g. after triaging).
  }, [api, activeLocationId, pathname]);

  // Live count of PENDING corporate requests for the nav badge. Workspace-AGNOSTIC
  // (no location_id until scheduled) — unlike PT, it's NOT filtered by the switcher.
  const [corporatePending, setCorporatePending] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!api) {
      setCorporatePending(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ corporate_requests: unknown[] }>(
          "/portal/admin/corporate-requests",
          { status: "pending" },
        );
        if (!cancelled) setCorporatePending(res.corporate_requests?.length || undefined);
      } catch {
        if (!cancelled) setCorporatePending(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-count when the route changes (e.g. after triaging a request).
  }, [api, pathname]);

  const inboxUnread = inboxItems.filter((i) => i.readAt === null).length;
  const badges: BadgeMap = {
    inboxUnread: inboxUnread > 0 ? inboxUnread : undefined,
    ptRequestsPending: ptPending,
    corporateRequestsPending: corporatePending,
  };

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.scope === "both") return true;
    if (role === "superadmin") return true; // superadmin sees everything
    return item.scope === "workspace"; // admin sees workspace + both
  });

  // Workspace zone: switcher-controlled surfaces, rendered first under the active location name.
  const workspaceItems = visibleItems.filter((i) => i.workspaceScoped);
  const activeLocationName =
    accessibleLocations.find((l) => l.id === activeLocationId)?.name ?? "Workspace";

  // Everything else, grouped by functional group.
  const groupedItems: Record<NavGroup, NavItem[]> = NAV_GROUP_ORDER.reduce(
    (acc, group) => {
      acc[group] = visibleItems.filter((i) => !i.workspaceScoped && i.group === group);
      return acc;
    },
    {} as Record<NavGroup, NavItem[]>
  );

  return (
    <div className="px-2.5 pt-1 pb-6">
      {workspaceItems.length > 0 && (
        <div className="mb-5 -mx-2.5 overflow-hidden border-b border-border px-2.5 pb-2.5">
          {/* Keyed on the active location so the content slides in on each workspace switch. */}
          <div key={activeLocationId ?? "none"} className="animate-slide-in-left">
            <div className="mb-1 flex items-center gap-2.5 px-2 pt-0.5 pb-1.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paper text-muted ring-1 ring-inset ring-border">
                <MapPin className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                  This location
                </div>
                <div
                  className="truncate text-[13px] font-semibold leading-tight text-ink"
                  title={activeLocationName}
                >
                  {activeLocationName}
                </div>
              </div>
            </div>
            <NavLinkList
              items={workspaceItems}
              pathname={pathname}
              onNavigate={onNavigate}
              staggered
              badges={badges}
            />
          </div>
        </div>
      )}

      {NAV_GROUP_ORDER.map((group) => {
        const items = groupedItems[group];
        if (items.length === 0) return null; // hide empty groups for admin
        // Settings is a single collapsible disclosure that nests all its items.
        if (group === "Settings") {
          return (
            <CollapsibleNavGroup
              key={group}
              label="Settings"
              items={items}
              pathname={pathname}
              onNavigate={onNavigate}
              badges={badges}
            />
          );
        }
        return (
          <div key={group} className="mb-5">
            <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted/70">
              {group}
            </div>
            <NavLinkList items={items} pathname={pathname} onNavigate={onNavigate} badges={badges} />
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
