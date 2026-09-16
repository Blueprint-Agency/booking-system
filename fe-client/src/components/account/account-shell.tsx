"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import {
  LayoutDashboard,
  CalendarCheck,
  UserRound,
  GraduationCap,
  UserCircle,
  Building2,
  ShoppingBag,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { AccountHeader } from "./account-header";
import { AccountMobileNav } from "./account-mobile-nav";

const navItems = [
  { href: "/account", label: "Overview", icon: LayoutDashboard, match: "exact" as const },
  { href: "/account/classes", label: "Classes", icon: CalendarCheck, match: "prefix" as const },
  { href: "/account/private-sessions", label: "Private Sessions", icon: UserRound, match: "prefix" as const },
  { href: "/account/corporate", label: "Corporate", icon: Building2, match: "prefix" as const },
  { href: "/account/workshops", label: "My Workshops", icon: GraduationCap, match: "prefix" as const },
  { href: "/account/merch", label: "My Merch", icon: ShoppingBag, match: "prefix" as const },
  { href: "/account/profile", label: "Profile", icon: UserCircle, match: "prefix" as const },
];

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { signOut } = useClerk();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useBodyScrollLock(confirmSignOut);

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
              onClick={() => setConfirmSignOut(true)}
              className="mt-4 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-error hover:bg-error/10 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </aside>

        {/* Mobile / tablet nav — the desktop sidebar is hidden below lg, so
            members on small screens reach the account sections from here.
            Centralised here so every account page gets it (and only once). */}
        <AccountMobileNav />

        <main className="min-w-0">{children}</main>
      </div>

      {confirmSignOut && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setConfirmSignOut(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-paper border border-ink/10 p-6 shadow-hover"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-ink">Sign out?</h3>
            <p className="mt-1 text-sm text-muted">
              You&apos;ll need to sign in again to access your account.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmSignOut(false)}
                className="flex-1 min-h-[44px] rounded-full border border-ink/10 px-4 text-sm font-medium hover:border-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => signOut({ redirectUrl: "/" })}
                className="flex-1 min-h-[44px] rounded-full bg-error px-4 text-sm font-medium text-paper hover:bg-error/90 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
