"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { useClientPackages } from "@/lib/use-client-packages";
import { useBrand } from "@/components/brand/brand-provider";

export function AppTopBar({ impersonating = false }: { impersonating?: boolean }) {
  const brand = useBrand();
  const { user, isSignedIn } = useUser();
  const isAuth = !!isSignedIn;
  const { classCredits, pt1on1, pt2on1, isUnlimited: unlimited } = useClientPackages();
  const sessionCredits = pt1on1 + pt2on1;
  const firstName = user?.firstName ?? "";
  const lastName = user?.lastName ?? "";
  const userInitials = isAuth ? (firstName.charAt(0) + lastName.charAt(0)).toUpperCase() || "U" : "";

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

        {isAuth ? (
          <div className="flex items-center gap-2.5">
            <Link
              href="/account"
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-warm border border-ink/10 hover:border-ink/20 transition-colors"
            >
              <span className="flex items-center gap-1.5" title="Class credits">
                <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                <span className="text-[12px] font-bold text-sage">{unlimited ? "∞" : classCredits}</span>
                <span className="hidden sm:inline text-[10px] font-medium text-muted">class credits</span>
              </span>
              <span className="w-px h-3 bg-ink/15" />
              <span className="flex items-center gap-1.5" title="PT sessions">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="text-[12px] font-bold text-accent-deep">{sessionCredits}</span>
                <span className="hidden sm:inline text-[10px] font-medium text-muted">PT sessions</span>
              </span>
            </Link>
            <Link
              href="/account"
              aria-label="Account"
              className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-[12px] font-bold text-accent-deep hover:bg-accent hover:text-inverse transition-colors"
            >
              {userInitials}
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-4 py-2 text-sm font-semibold text-ink hover:text-accent-deep transition-colors">
              Log in
            </Link>
            <Link href="/register" className="px-4 py-2 text-sm font-bold text-inverse bg-accent rounded-full hover:bg-accent-deep transition-colors">
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
