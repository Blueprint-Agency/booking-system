"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useMockState, signOut, getActiveClassCredits, getActiveSessionCredits, hasActiveUnlimited } from "@/lib/mock-state";

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
  const state = useMockState();
  const isAuth = !!state.user;
  const classCredits = getActiveClassCredits(state);
  const sessionCredits = getActiveSessionCredits(state);
  const unlimited = hasActiveUnlimited(state);
  const userInitials = state.user
    ? (state.user.firstName.charAt(0) + (state.user.lastName?.charAt(0) ?? "")).toUpperCase() || "U"
    : "";
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
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
        <div className="flex items-center justify-between h-[72px]">
          {/* Logo — official Yoga Sadhana wordmark */}
          <Link href="/" className="flex items-center shrink-0" aria-label="Yoga Sadhana home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://i0.wp.com/yogasadhana.sg/wp-content/uploads/2025/02/Yoga_Sadhana_header_logo_circle.png?w=294&ssl=1"
              alt="Yoga Sadhana"
              className="h-12 w-auto"
            />
          </Link>

          {/* Desktop center nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "px-3.5 py-2 text-sm font-semibold rounded-md transition-colors duration-200",
                  isActive(href)
                    ? "text-accent-deep bg-accent/10"
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
                  "px-3.5 py-2 text-sm font-semibold rounded-md transition-colors duration-200",
                  isActive("/account")
                    ? "text-accent-deep bg-accent/10"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                My Account
              </Link>
            )}
          </nav>

          {/* Right side — credit pill + avatar dropdown OR sign-in CTA */}
          <div className="hidden md:flex items-center gap-3">
            {isAuth ? (
              <div className="relative group">
                <button className="flex items-center gap-2.5" aria-label="Account menu">
                  <Link
                    href="/account"
                    className="flex items-center gap-2 px-3 py-2 rounded-md bg-warm border border-ink/10 hover:border-ink/20 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="flex items-center gap-1.5" title="Class credits">
                      <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                      <span className="text-[12px] font-bold text-sage">
                        {unlimited ? "∞" : classCredits}
                      </span>
                      <span className="text-[10px] font-medium text-muted">class credits</span>
                    </span>
                    <span className="w-px h-3 bg-ink/15" />
                    <span className="flex items-center gap-1.5" title="PT sessions">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                      <span className="text-[12px] font-bold text-accent-deep">
                        {sessionCredits}
                      </span>
                      <span className="text-[10px] font-medium text-muted">PT sessions</span>
                    </span>
                  </Link>
                  <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-[12px] font-bold text-accent-deep group-hover:bg-accent group-hover:text-inverse transition-colors duration-200">
                    {userInitials}
                  </div>
                </button>
                <div className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-lg shadow-hover opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 overflow-hidden">
                  <div className="px-4 pt-4 pb-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center text-[13px] font-bold text-accent-deep shrink-0">
                      {userInitials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink truncate leading-tight">
                        {state.user?.firstName} {state.user?.lastName}
                      </p>
                      <p className="text-[11px] text-muted truncate leading-tight mt-0.5">{state.user?.email}</p>
                    </div>
                  </div>

                  <div className="border-t border-border py-1">
                    <Link href="/account" className="flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M7 8h6M7 11h6M7 14h4"/></svg>
                      Overview
                    </Link>
                    <Link href="/account/classes" className="flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 3v3M13 3v3"/></svg>
                      Classes
                    </Link>
                    <Link href="/account/private-sessions" className="flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="7" r="3.2"/><path d="M3.5 17c1.2-3.2 3.8-5 6.5-5s5.3 1.8 6.5 5"/></svg>
                      Private Sessions
                    </Link>
                    <Link href="/account/workshops" className="flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4L3 8l7 4 7-4-7-4z"/><path d="M6 10v3.5c1 1 2.5 1.5 4 1.5s3-0.5 4-1.5V10M17 8v4"/></svg>
                      My Workshops
                    </Link>
                    <Link href="/account/profile" className="flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="7" r="3.2"/><path d="M3.5 17c1.2-3.2 3.8-5 6.5-5s5.3 1.8 6.5 5"/></svg>
                      Profile
                    </Link>
                  </div>
                  <div className="border-t border-border">
                    <button
                      onClick={() => signOut()}
                      className="flex items-center gap-2.5 w-full text-left px-4 py-2.5 text-[13px] font-medium text-error hover:bg-error/10 transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15l4-5-4-5M16 10H7M8 4H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>
                      Log out
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <Link href="/login" className="px-4 py-2 text-sm font-semibold text-ink hover:text-accent-deep transition-colors">
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="px-5 py-2.5 text-sm font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors duration-200"
                >
                  Sign up
                </Link>
              </>
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
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2.5 text-sm font-semibold rounded-md transition-colors",
                  isActive(href)
                    ? "text-accent-deep bg-accent/10"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {label}
              </Link>
            ))}
            {isAuth ? (
              <>
                <Link
                  href="/account"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "px-3 py-2.5 text-sm font-semibold rounded-md transition-colors",
                    isActive("/account")
                      ? "text-accent-deep bg-accent/10"
                      : "text-muted hover:text-ink hover:bg-warm"
                  )}
                >
                  My Account
                </Link>
                <div className="grid grid-cols-2 gap-3 mx-1 mt-4 mb-2">
                  <div className="rounded-xl bg-sage/10 border border-sage/20 px-4 py-3.5">
                    <span className="text-2xl font-extrabold text-sage leading-none block">
                      {unlimited ? "∞" : classCredits}
                    </span>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-sage/80 mt-2">
                      Class credits
                    </p>
                  </div>
                  <div className="rounded-xl bg-accent/10 border border-accent/20 px-4 py-3.5">
                    <span className="text-2xl font-extrabold text-accent-deep leading-none block">
                      {sessionCredits}
                    </span>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-deep/80 mt-2">
                      PT sessions
                    </p>
                  </div>
                </div>
                <div className="border-t border-border my-2" />
                <button
                  onClick={() => { signOut(); setMobileOpen(false); }}
                  className="text-left px-3 py-2.5 text-sm font-semibold rounded-md text-error hover:bg-error/10 transition-colors"
                >
                  Log out
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-semibold rounded-md border border-ink/10 text-ink text-center hover:bg-warm transition-colors"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-bold rounded-md bg-accent text-inverse text-center hover:bg-accent-deep transition-colors"
                >
                  Sign up
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
