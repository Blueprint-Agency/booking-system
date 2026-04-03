"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/account", label: "Overview" },
  { href: "/account/history", label: "History" },
  { href: "/account/packages", label: "Packages" },
  { href: "/account/membership", label: "Membership" },
  { href: "/account/referral", label: "Referral" },
  { href: "/account/invoices", label: "Invoices" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/qr", label: "My QR" },
];

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/account") return pathname === "/account";
    return pathname.startsWith(href);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-serif text-3xl text-ink mb-8">My Account</h1>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Desktop sidebar */}
        <nav className="hidden md:flex flex-col w-[200px] shrink-0 gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-4 py-2.5 text-sm font-medium rounded-r-[--radius-md] border-l-2 transition-colors duration-200",
                isActive(item.href)
                  ? "text-accent-deep border-accent-deep bg-accent-glow/20"
                  : "text-muted border-transparent hover:text-ink hover:bg-warm hover:border-border"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Mobile horizontal tabs */}
        <nav className="md:hidden -mx-4 px-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-1 min-w-max pb-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap border-b-2 transition-colors duration-200",
                  isActive(item.href)
                    ? "text-accent-deep border-accent-deep bg-accent-glow/20"
                    : "text-muted border-transparent hover:text-ink hover:bg-warm"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
