"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  GraduationCap,
  UserCog,
  QrCode,
  Users,
  Users2,
  MapPin,
  Receipt,
  BarChart3,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { heading: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    heading: "Core",
    items: [
      { href: "/classes", label: "Classes", icon: CalendarDays },
      { href: "/workshops", label: "Workshops", icon: GraduationCap },
      { href: "/private-sessions", label: "Private Sessions", icon: UserCog },
    ],
  },
  {
    heading: "Operate",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/check-in", label: "Check-in", icon: QrCode },
    ],
  },
  {
    heading: "Manage",
    items: [
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/instructors", label: "Instructors", icon: Users2 },
      { href: "/locations", label: "Locations", icon: MapPin },
    ],
  },
  {
    heading: "Finance",
    items: [
      { href: "/invoices", label: "Invoices", icon: Receipt },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    heading: "System",
    items: [
      { href: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-60 flex-col border-r border-border bg-card">
      <div className="px-5 py-5 border-b border-border">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-full bg-accent text-paper flex items-center justify-center font-extrabold text-sm">YS</span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-ink">Yoga Sadhana</span>
            <span className="text-[11px] font-mono text-muted uppercase tracking-wider">Admin</span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {GROUPS.map((group) => (
          <div key={group.heading} className="px-3 mb-5">
            <p className="px-2 text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">
              {group.heading}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-accent/10 text-accent-deep font-medium"
                          : "text-ink/80 hover:bg-warm hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
