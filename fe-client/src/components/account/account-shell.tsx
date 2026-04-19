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
  LogOut,
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

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="bg-warm min-h-[calc(100vh-72px-320px)]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-16 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block lg:sticky lg:top-24 self-start rounded-3xl bg-card border border-ink/5 shadow-soft p-6">
          <AccountHeader />
          <nav className="mt-6 flex flex-col gap-1" aria-label="Account">
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
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    active
                      ? "bg-ink text-paper"
                      : "text-muted hover:bg-warm hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
            <button
              type="button"
              className="mt-4 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-error hover:bg-error/10 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </aside>

        {/* Mobile/tablet header + tab strip */}
        <div className="lg:hidden space-y-4">
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

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
