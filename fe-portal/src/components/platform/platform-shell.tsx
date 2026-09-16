"use client";
import { useClerk, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Chrome for the super portal.
 *
 * One bar, no navigation: there is exactly one page here, and a sidebar of one
 * item is furniture. It looks deliberately unlike a studio's portal — this is
 * the surface where a studio can be suspended, and the operator should never be
 * a moment's confusion away from thinking they are inside one.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-ink px-4 py-3 text-paper sm:px-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">ReserveToday</p>
          <p className="text-xs text-paper/70">Super portal — platform administration</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {user?.primaryEmailAddress && (
            <span className="hidden text-xs text-paper/70 sm:inline">
              {user.primaryEmailAddress.emailAddress}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void signOut(() => router.push("/login"))}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
