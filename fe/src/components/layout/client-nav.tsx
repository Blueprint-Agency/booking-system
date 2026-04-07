"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { MOCK_USER } from "@/data/mock-user";

const NAV_LINKS = [
  { href: "/classes", label: "Classes" },
  { href: "/workshops", label: "Workshops" },
  { href: "/private-sessions", label: "Private Sessions" },
  { href: "/packages", label: "Packages" },
];

export function ClientNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isAuth = true; // Mock: always authenticated for prototype
  const isHome = pathname === "/";

  useEffect(() => {
    if (!isHome) {
      setScrolled(false);
      return;
    }
    const handleScroll = () => setScrolled(window.scrollY > 40);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isHome]);

  const isTransparent = isHome && !scrolled;

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        isTransparent
          ? "bg-transparent"
          : "bg-paper/95 backdrop-blur-sm border-b border-border"
      )}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-inverse font-bold text-sm">Y</span>
            </div>
            <span className="font-serif text-xl text-ink">Yoga Sadhana</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200",
                  isActive(href)
                    ? "text-accent-deep bg-accent/15"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {label}
              </Link>
            ))}
            {isAuth && (
              <Link
                href="/account"
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200",
                  isActive("/account")
                    ? "text-accent-deep bg-accent/15"
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
              <div className="relative group">
                <button className="flex items-center gap-2" aria-label="Account menu">
                  {/* Credit pill — always visible */}
                  <Link
                    href="/account/packages"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sage/10 border border-sage/20 hover:border-sage/40 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                    <span className="text-xs font-semibold text-sage">{MOCK_USER.classCredits}</span>
                    <span className="text-[10px] text-muted">credits</span>
                  </Link>
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-semibold text-accent-deep group-hover:bg-accent group-hover:text-inverse transition-colors duration-200">
                    {MOCK_USER.initials}
                  </div>
                </button>
                <div className="absolute right-0 top-full mt-1.5 w-56 bg-card border border-border rounded-lg shadow-hover opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 py-1">
                  {/* Credit summary in dropdown */}
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-ink">Class Credits</span>
                      <span className="text-xs font-semibold text-sage">{MOCK_USER.classCredits} left</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-warm overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sage transition-all"
                        style={{ width: `${(MOCK_USER.classCredits / MOCK_USER.classPackageTotal) * 100}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted mt-1">{MOCK_USER.classPackageName} · expires {new Date(MOCK_USER.classPackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
                    {MOCK_USER.pt1on1Credits > 0 && (
                      <>
                        <div className="flex items-center justify-between mt-3 mb-1.5">
                          <span className="text-xs font-medium text-ink">PT Credits (1-on-1)</span>
                          <span className="text-xs font-semibold text-accent-deep">{MOCK_USER.pt1on1Credits} left</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-warm overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${(MOCK_USER.pt1on1Credits / MOCK_USER.pt1on1PackageTotal) * 100}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted mt-1">{MOCK_USER.pt1on1PackageName} · expires {new Date(MOCK_USER.pt1on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
                      </>
                    )}
                    {MOCK_USER.pt2on1Credits > 0 && MOCK_USER.pt2on1PackageName && MOCK_USER.pt2on1PackageExpiry && (
                      <>
                        <div className="flex items-center justify-between mt-3 mb-1.5">
                          <span className="text-xs font-medium text-ink">PT Credits (2-on-1)</span>
                          <span className="text-xs font-semibold text-warning">{MOCK_USER.pt2on1Credits} left</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-warm overflow-hidden">
                          <div
                            className="h-full rounded-full bg-warning transition-all"
                            style={{ width: `${(MOCK_USER.pt2on1Credits / MOCK_USER.pt2on1PackageTotal) * 100}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted mt-1">{MOCK_USER.pt2on1PackageName} · expires {new Date(MOCK_USER.pt2on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
                      </>
                    )}
                  </div>
                  <Link
                    href="/account"
                    className="block px-4 py-2 text-sm text-muted hover:text-ink hover:bg-warm transition-colors"
                  >
                    My Bookings
                  </Link>
                  <Link
                    href="/account/packages"
                    className="block px-4 py-2 text-sm text-muted hover:text-ink hover:bg-warm transition-colors"
                  >
                    My Packages
                  </Link>
                  <Link
                    href="/account/qr"
                    className="block px-4 py-2 text-sm text-muted hover:text-ink hover:bg-warm transition-colors"
                  >
                    My QR Code
                  </Link>
                  <Link
                    href="/account/profile"
                    className="block px-4 py-2 text-sm text-muted hover:text-ink hover:bg-warm transition-colors"
                  >
                    Profile
                  </Link>
                  <div className="border-t border-border my-1" />
                  <Link
                    href="/login"
                    className="block px-4 py-2 text-sm text-error hover:bg-error/10 transition-colors"
                  >
                    Log out
                  </Link>
                </div>
              </div>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-medium text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors duration-200"
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
              <span
                className={cn(
                  "block h-0.5 bg-ink transition-transform duration-200",
                  mobileOpen && "rotate-45 translate-y-1.5"
                )}
              />
              <span
                className={cn(
                  "block h-0.5 bg-ink transition-opacity duration-200",
                  mobileOpen && "opacity-0"
                )}
              />
              <span
                className={cn(
                  "block h-0.5 bg-ink transition-transform duration-200",
                  mobileOpen && "-rotate-45 -translate-y-1.5"
                )}
              />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-paper animate-fade-in">
          <nav className="flex flex-col p-4 gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2.5 text-sm font-medium rounded-md transition-colors",
                  isActive(href)
                    ? "text-accent-deep bg-accent/15"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {label}
              </Link>
            ))}
            {isAuth ? (
              <>
                {/* Mobile credit summary */}
                <div className="mx-3 my-2 p-3 rounded-lg bg-sage/10 border border-sage/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                      <span className="text-xs font-semibold text-sage">{MOCK_USER.classCredits} class credits</span>
                    </div>
                    <span className="text-[10px] text-muted">{MOCK_USER.classPackageName}</span>
                  </div>
                  {MOCK_USER.pt1on1Credits > 0 && (
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-deep" />
                        <span className="text-xs font-semibold text-accent-deep">{MOCK_USER.pt1on1Credits} PT (1-on-1)</span>
                      </div>
                      <span className="text-[10px] text-muted">{MOCK_USER.pt1on1PackageName}</span>
                    </div>
                  )}
                  {MOCK_USER.pt2on1Credits > 0 && MOCK_USER.pt2on1PackageName && (
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                        <span className="text-xs font-semibold text-warning">{MOCK_USER.pt2on1Credits} PT (2-on-1)</span>
                      </div>
                      <span className="text-[10px] text-muted">{MOCK_USER.pt2on1PackageName}</span>
                    </div>
                  )}
                  <Link
                    href="/account/packages"
                    onClick={() => setMobileOpen(false)}
                    className="block text-[11px] text-accent font-medium mt-2 hover:text-accent-deep transition-colors"
                  >
                    View all packages →
                  </Link>
                </div>

                <div className="border-t border-border my-2" />
                <Link
                  href="/account"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "px-3 py-2.5 text-sm font-medium rounded-md transition-colors",
                    isActive("/account")
                      ? "text-accent-deep bg-accent/15"
                      : "text-muted hover:text-ink hover:bg-warm"
                  )}
                >
                  My Account
                </Link>
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium rounded-md text-error hover:bg-error/10 transition-colors"
                >
                  Log out
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2.5 text-sm font-medium rounded-md bg-accent text-inverse hover:bg-accent-deep transition-colors"
              >
                Log In
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
