"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signInPathFor } from "@/lib/auth-redirect";
import { useMemberSession } from "@/lib/member-auth";
import { cn } from "@/lib/utils";
import { ContentLoading } from "@/components/ui/content-loading";
import { AccountHeader } from "./account-header";
import { ACCOUNT_OVERVIEW, ACCOUNT_SECTIONS } from "./account-nav-items";
import { SignOutButton, SigningOutContext } from "./sign-out-button";

/**
 * The frame around every account page. From `lg` up it is a sidebar beside the
 * page; below that the same sections are a row of tabs above it
 * (`AccountTabs`), so a phone and a desktop reach every section the same way.
 */
export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useMemberSession();
  const [signingOut, setSigningOut] = useState(false);
  const markSigningOut = useCallback(() => setSigningOut(true), []);

  // The account pages are a member's, and the edge cannot tell (the session is
  // a token in this page's storage), so this is the gate: a signed-out visitor
  // is sent to sign in and brought back. Not while signing out, which goes home.
  const mustSignIn = isLoaded && !isSignedIn && !signingOut;
  useEffect(() => {
    if (mustSignIn) router.replace(signInPathFor(pathname, window.location.search));
  }, [mustSignIn, pathname, router]);

  if (!isLoaded || !isSignedIn) {
    return (
      <ContentLoading label="Loading your account" className="min-h-[60vh]" />
    );
  }

  return (
    <SigningOutContext.Provider value={markSigningOut}>
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-10 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6 lg:gap-10">
      <aside className="hidden lg:block lg:sticky lg:top-24 self-start">
        <div className="rounded-2xl bg-card border border-ink/5 shadow-soft p-3">
          <div className="p-3 pb-4 border-b border-ink/5">
            <AccountHeader />
          </div>
          <nav className="mt-2 flex flex-col gap-0.5" aria-label="Account">
            {[ACCOUNT_OVERVIEW, ...ACCOUNT_SECTIONS].map(({ href, label, icon: Icon, isActive }) => {
              const active = isActive(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                    active
                      ? "bg-accent/10 text-accent-deep"
                      : "text-muted hover:bg-ink/5 hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.3 : 1.8} />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-2 pt-2 border-t border-ink/5">
            <SignOutButton
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-error hover:bg-error/10 transition-colors"
            />
          </div>
        </div>
      </aside>

      <div className="min-w-0 animate-fade-in">
        <AccountTabs pathname={pathname} />
        {children}
      </div>
    </div>
    </SigningOutContext.Provider>
  );
}

/**
 * The account's sections below `lg`, where there is no sidebar: the same
 * items in the same order, as a row of tabs that scrolls sideways rather than
 * wrapping. Sign out sits at the foot of Profile & security on a phone.
 */
function AccountTabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Account" className="lg:hidden -mx-4 mb-5 overflow-x-auto px-4 no-scrollbar md:-mx-8 md:px-8">
      <ul className="flex w-max gap-2">
        {[ACCOUNT_OVERVIEW, ...ACCOUNT_SECTIONS].map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors",
                  active
                    ? "border-accent/20 bg-accent/10 text-accent-deep"
                    : "border-ink/10 bg-card text-muted hover:border-ink/25 hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
