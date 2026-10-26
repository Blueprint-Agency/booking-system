"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppUser } from "@/lib/auth";
import { authLinksFor } from "@/lib/auth-redirect";
import { cn } from "@/lib/utils";
import { useBrand } from "@/components/brand/brand-provider";
import { Avatar } from "@/components/ui/avatar";

export function AppTopBar({ impersonating = false }: { impersonating?: boolean }) {
  const brand = useBrand();
  const { user, isLoaded, isSignedIn: isAuth } = useAppUser();
  // Log in and Sign up come back to this page, as the page's own sign-in
  // prompts do (AUTH-07), whichever of them the visitor taps.
  const authLinks = authLinksFor(usePathname() ?? "/");

  return (
    <header
      className={cn(
        "sticky z-40 h-16 bg-paper/95 backdrop-blur-sm border-b border-border",
        impersonating ? "top-10" : "top-0",
      )}
    >
      <div className="h-full max-w-[1280px] mx-auto px-4 sm:px-6 flex items-center justify-between">
        {/* The studio's mark, or its name when it has supplied none. Never a
            placeholder logo: a studio would rather read its own name than see
            another studio's wordmark. */}
        <Link href="/" className="flex items-center shrink-0" aria-label={`${brand.name} home`}>
          {brand.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={brand.logoUrl} alt={brand.name} className="h-10 w-auto" />
          ) : (
            <span className="text-lg font-bold tracking-tight text-ink">{brand.name}</span>
          )}
        </Link>

        {/* Nothing until the session is read: a signed-in member would
            otherwise see Log in / Sign up on every load, then their avatar. */}
        {!isLoaded ? (
          <div className="h-9 w-9" aria-hidden />
        ) : isAuth && user ? (
          <div className="flex items-center">
            <Link
              href="/account"
              aria-label="Account"
              className="group rounded-full"
            >
              <Avatar
                name={`${user.firstName} ${user.lastName}`}
                email={user.email}
                photoUrl={user.photoUrl}
                className="h-9 w-9 bg-accent/15 text-[12px] text-accent-deep ring-accent ring-offset-2 ring-offset-paper group-hover:bg-accent group-hover:text-inverse group-hover:ring-2 transition-colors"
              />
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href={authLinks.login} className="px-4 py-2 text-sm font-semibold text-ink hover:text-accent-deep transition-colors">
              Log in
            </Link>
            <Link href={authLinks.register} className="px-4 py-2 text-sm font-bold text-inverse bg-accent rounded-full hover:bg-accent-deep dark:hover:bg-accent/85 transition-colors">
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
