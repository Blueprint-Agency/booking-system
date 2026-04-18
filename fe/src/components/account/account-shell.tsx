"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  History,
  Package,
  Crown,
  Share2,
  Receipt,
  UserCircle,
  QrCode,
  Power,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountHeader } from "./account-header";

const navItems = [
  { href: "/account", label: "Overview", icon: LayoutDashboard },
  { href: "/account/history", label: "History", icon: History },
  { href: "/account/packages", label: "Packages", icon: Package },
  { href: "/account/membership", label: "Membership", icon: Crown },
  { href: "/account/referral", label: "Referral", icon: Share2 },
  { href: "/account/invoices", label: "Invoices", icon: Receipt },
  { href: "/account/profile", label: "Profile", icon: UserCircle },
  { href: "/account/qr", label: "My QR", icon: QrCode },
];

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="bg-warm min-h-[calc(100vh-72px-320px)]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 md:py-16 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-10">
        <aside className="lg:sticky lg:top-24 self-start rounded-3xl bg-card border border-ink/5 shadow-soft p-6">
          <AccountHeader />
          <nav className="mt-6 flex flex-col gap-1" aria-label="Account">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/account"
                  ? pathname === "/account"
                  : pathname.startsWith(href);
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
              <Power className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </aside>

        <main>{children}</main>
      </div>
    </div>
  );
}
