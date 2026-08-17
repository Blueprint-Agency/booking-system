"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Menu,
  X,
  CalendarDays,
  CalendarOff,
  HandHeart,
  Wallet,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

interface InstructorNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

function NavBrand() {
  return (
    <Link
      href="/instructor/schedule"
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
}: {
  items: InstructorNavItem[];
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
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                isActive
                  ? "bg-accent/10 font-medium text-accent"
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
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={cn(
                    "inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    isActive ? "bg-accent/15 text-accent" : "bg-warning/20 text-warning"
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function useInstructorNavItems(): InstructorNavItem[] {
  const { api } = useWorkspace();
  const pathname = usePathname() ?? "";
  const [ptPending, setPtPending] = useState<number | undefined>(undefined);

  // Live count of the shared pending PT queue for the nav badge.
  useEffect(() => {
    if (!api) {
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
  }, [api, pathname]);

  return [
    { label: "My Schedule", href: "/instructor/schedule", icon: CalendarDays },
    { label: "PT Requests", href: "/instructor/pt-requests", icon: HandHeart, badge: ptPending },
    { label: "My Leave", href: "/instructor/leave", icon: CalendarOff },
    { label: "Teaching log", href: "/instructor/payroll", icon: Wallet },
    { label: "Profile", href: "/instructor/profile", icon: UserRound },
  ];
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
    <nav className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
      <NavBrand />
      <NavContent />
    </nav>
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
