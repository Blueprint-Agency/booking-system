"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCheck,
  UserRound,
  GraduationCap,
  Share2,
  Receipt,
  UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountHeader } from "./account-header";

const navItems = [
  { href: "/account", label: "Overview", icon: LayoutDashboard, match: "exact" as const },
  { href: "/account/classes", label: "Classes", icon: CalendarCheck, match: "prefix" as const },
  { href: "/account/private-sessions", label: "Private Sessions", icon: UserRound, match: "prefix" as const },
  { href: "/account/workshops", label: "My Workshops", icon: GraduationCap, match: "prefix" as const },
  { href: "/account/referral", label: "Referral", icon: Share2, match: "prefix" as const },
  { href: "/account/invoices", label: "Invoices", icon: Receipt, match: "prefix" as const },
  { href: "/account/profile", label: "Profile", icon: UserCircle, match: "prefix" as const },
];

export function AccountMobileNav() {
  const pathname = usePathname();
  return (
    <div className="lg:hidden space-y-4 mb-6">
      <div className="rounded-2xl bg-card border border-ink/5 shadow-soft p-5">
        <AccountHeader />
      </div>
      <nav
        className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4"
        aria-label="Account"
      >
        {navItems.map((item) => {
          const { href, label, icon: Icon } = item;
          const active =
            item.match === "exact"
              ? pathname === "/account"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap border",
                active
                  ? "bg-ink text-paper border-ink"
                  : "text-muted bg-card border-ink/10 hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
