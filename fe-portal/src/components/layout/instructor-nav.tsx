"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { createPortal } from "react-dom";
import { StudioMark } from "@/components/brand/studio-mark";
import { useWorkspace } from "@/lib/workspace-context";
import { SidebarBrand, SidebarFrame, SidebarLink } from "./sidebar";
import { instructorNavItems, type InstructorNavItem } from "./instructor-nav-items";

interface BadgedNavItem extends InstructorNavItem {
  badge?: number;
}

function NavBrand() {
  return (
    <SidebarBrand href="/instructor/schedule">
      <StudioMark />
    </SidebarBrand>
  );
}

function NavLinkList({
  items,
  pathname,
  onNavigate,
}: {
  items: BadgedNavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <li key={item.href}>
            <SidebarLink
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive}
              badge={item.badge}
              onNavigate={onNavigate}
            />
          </li>
        );
      })}
    </ul>
  );
}

function useInstructorNavItems(): BadgedNavItem[] {
  const { api, may } = useWorkspace();
  const pathname = usePathname() ?? "";
  const [ptPending, setPtPending] = useState<number | undefined>(undefined);
  const takesPt = may("take_pt_bookings");

  // Live count of the shared pending PT queue for the nav badge. Not asked
  // for without Take PT bookings: the backend would refuse it.
  useEffect(() => {
    if (!api || !takesPt) {
      setPtPending(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ pt_requests: unknown[] }>(
          "/portal/instructor/pt-requests"
        );
        if (!cancelled) setPtPending(res.pt_requests?.length || undefined);
      } catch {
        if (!cancelled) setPtPending(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, pathname, takesPt]);

  return instructorNavItems(may).map((item) =>
    item.permission === "take_pt_bookings" ? { ...item, badge: ptPending } : item
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const items = useInstructorNavItems();
  return (
    <div className="px-2.5 pt-1 pb-6">
      <NavLinkList items={items} pathname={pathname} onNavigate={onNavigate} />
    </div>
  );
}

export function InstructorNav() {
  return (
    <SidebarFrame brand={<NavBrand />}>
      <NavContent />
    </SidebarFrame>
  );
}

export function InstructorMobileNavTrigger() {
  const [open, setOpen] = useState(false);

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
        className="-ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink hover:bg-paper lg:hidden"
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
                    className="rounded-md p-2.5 text-muted hover:bg-paper hover:text-ink"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <NavContent onNavigate={() => setOpen(false)} />
                </div>
              </aside>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
