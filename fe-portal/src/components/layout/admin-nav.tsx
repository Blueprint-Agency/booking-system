"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, MapPin, Settings, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { NAV_ITEMS, NAV_GROUP_ORDER, type NavItem, type NavGroup } from "./nav-items";
import { cn } from "@/lib/utils";
import { StudioMark } from "@/components/brand/studio-mark";
import { visibleToRole } from "@/lib/staff-role";
import { useWorkspace } from "@/lib/workspace-context";
import {
  SidebarBrand,
  SidebarFrame,
  SidebarHeading,
  SidebarLink,
  useRailTip,
  useSidebar,
} from "./sidebar";

type BadgeMap = Partial<Record<NonNullable<NavItem["badgeKey"]>, number | undefined>>;

function NavBrand() {
  return (
    <SidebarBrand href="/admin/schedule">
      <StudioMark />
    </SidebarBrand>
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
            <SidebarLink
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive}
              badge={badge}
              onNavigate={onNavigate}
              onAccent={onAccent}
            />
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
  const { collapsed } = useSidebar();
  // Auto-open when navigating into one of its children.
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  // In the rail there is no room for a disclosure — its items sit flat, under a
  // rule like every other group.
  if (collapsed) {
    return (
      <div className="mb-4">
        <SidebarHeading>{label}</SidebarHeading>
        <NavLinkList items={items} pathname={pathname} onNavigate={onNavigate} badges={badges} />
      </div>
    );
  }

  return (
    <div className="mb-4">
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

  const badges: BadgeMap = {
    ptRequestsPending: ptPending,
    corporateRequestsPending: corporatePending,
  };

  const visibleItems = NAV_ITEMS.filter((item) => visibleToRole(item, role));

  // Workspace zone: switcher-controlled surfaces, rendered first under the active location name.
  const workspaceItems = visibleItems.filter((i) => i.workspaceScoped);
  const activeLocationName =
    accessibleLocations.find((l) => l.id === activeLocationId)?.name ?? "Workspace";
  const { collapsed } = useSidebar();
  const locationTip = useRailTip(activeLocationName);

  // Everything else, grouped by functional group.
  const groupedItems: Record<NavGroup, NavItem[]> = NAV_GROUP_ORDER.reduce(
    (acc, group) => {
      acc[group] = visibleItems.filter((i) => !i.workspaceScoped && i.group === group);
      return acc;
    },
    {} as Record<NavGroup, NavItem[]>
  );

  return (
    <div className="px-2.5 pt-1 pb-4">
      {workspaceItems.length > 0 && (
        <div className="mb-4 -mx-2.5 overflow-hidden border-b border-border px-2.5 pb-2.5">
          {/* Keyed on the active location so the content slides in on each workspace switch. */}
          <div key={activeLocationId ?? "none"} className="animate-slide-in-left">
            <div
              className={cn(
                "mb-1 flex items-center gap-2.5 pt-0.5 pb-1.5",
                collapsed ? "justify-center" : "px-2"
              )}
            >
              <span
                {...locationTip}
                aria-label={collapsed ? `This location: ${activeLocationName}` : undefined}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paper text-muted ring-1 ring-inset ring-border"
              >
                <MapPin className="h-[18px] w-[18px]" />
              </span>
              <div className={collapsed ? "sr-only" : "min-w-0"}>
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
          <div key={group} className="mb-4">
            <SidebarHeading>{group}</SidebarHeading>
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
    <SidebarFrame brand={<NavBrand />}>
      <NavContent pathname={pathname} />
    </SidebarFrame>
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
