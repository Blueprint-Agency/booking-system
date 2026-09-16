"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { signOutPortal, usePortalSession } from "@/lib/portal-auth";

/**
 * Chrome for the super portal, and its sign-in gate.
 *
 * One bar, no navigation: there is exactly one page here, and a sidebar of one
 * item is furniture. It looks deliberately unlike a studio's portal — this is
 * the surface where a studio can be suspended, and the operator should never be
 * a moment's confusion away from thinking they are inside one.
 *
 * **The gate.** The session is a `platform` pool bearer token in this
 * hostname's storage (`lib/portal-auth.ts`), which the edge never sees, so a
 * visitor with none is sent to `/login` from here, remembering where they were
 * going. Whether a session may *use* the super portal is the backend's call
 * (`PLATFORM_ADMIN_EMAILS`), and the page renders its refusal.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { isLoaded, session } = usePortalSession();
  const router = useRouter();
  const pathname = usePathname();
  const isSignedIn = session !== null;

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    const next = `${pathname ?? ""}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
    // `pathname` is read, not watched: this runs when the session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, router]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-ink px-4 py-3 text-paper sm:px-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">ReserveToday</p>
          <p className="text-xs text-paper/70">Super portal — platform administration</p>
        </div>
        {session && (
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-paper/70 sm:inline">{session.email}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void signOutPortal().finally(() => router.push("/login"))}
            >
              Sign out
            </Button>
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {session ? (
          children
        ) : (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        )}
      </main>
    </div>
  );
}
