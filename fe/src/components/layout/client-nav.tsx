"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/sessions", label: "Sessions" },
  { href: "/pricing", label: "Pricing" },
];

const AUTH_LINKS = [
  { href: "/account", label: "My Bookings" },
  { href: "/account/packages", label: "Packages" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/qr", label: "My QR Code" },
];

export function ClientNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Mock: always show as authenticated for prototype
  const isAuth = true;

  return (
    <header className="sticky top-0 z-50 bg-paper/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-serif text-xl text-ink">Teeko</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200",
                  pathname.startsWith(link.href)
                    ? "text-accent-deep bg-accent-glow/40"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {link.label}
              </Link>
            ))}
            {isAuth && (
              <Link
                href="/account"
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200",
                  pathname.startsWith("/account")
                    ? "text-accent-deep bg-accent-glow/40"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                My Bookings
              </Link>
            )}
          </nav>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-3">
            {isAuth ? (
              <Link href="/account/profile" className="flex items-center gap-2 group">
                <div className="w-8 h-8 rounded-full bg-accent-glow flex items-center justify-center text-xs font-semibold text-accent-deep group-hover:bg-accent group-hover:text-white transition-colors duration-200">
                  SK
                </div>
              </Link>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors duration-200"
              >
                Log In
              </Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-md hover:bg-warm transition-colors"
            aria-label="Toggle menu"
          >
            <div className="w-5 flex flex-col gap-1">
              <span className={cn("block h-0.5 bg-ink transition-transform duration-200", mobileOpen && "rotate-45 translate-y-1.5")} />
              <span className={cn("block h-0.5 bg-ink transition-opacity duration-200", mobileOpen && "opacity-0")} />
              <span className={cn("block h-0.5 bg-ink transition-transform duration-200", mobileOpen && "-rotate-45 -translate-y-1.5")} />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-paper animate-fade-in">
          <nav className="flex flex-col p-4 gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2.5 text-sm font-medium rounded-md transition-colors",
                  pathname.startsWith(link.href) ? "text-accent-deep bg-accent-glow/40" : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="border-t border-border my-2" />
            {AUTH_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2.5 text-sm font-medium rounded-md transition-colors",
                  pathname === link.href ? "text-accent-deep bg-accent-glow/40" : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
