"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOutMember } from "@/lib/member-auth";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";

/**
 * Set by `AccountShell`: tells its sign-in gate a sign-out is under way, so the
 * moment between the session ending and the redirect home does not bounce the
 * member to the sign-in page instead.
 */
export const SigningOutContext = createContext<() => void>(() => {});

/**
 * "Sign out", with its confirmation. Self-contained so the desktop sidebar and
 * the mobile account menu each carry one — before, only the sidebar did, and a
 * member on a phone had no way to sign out.
 */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const onSigningOut = useContext(SigningOutContext);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(confirming);
  useBodyScrollLock(confirming);

  async function signOut() {
    setBusy(true);
    onSigningOut();
    try {
      await signOutMember();
    } finally {
      router.replace("/");
    }
  }

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className={className}>
        <LogOut className="h-4 w-4 shrink-0" />
        Sign out
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink/40 p-4"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            ref={trapRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-modal outline-none animate-fade-up"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && !busy && setConfirming(false)}
          >
            <h3 id="sign-out-title" className="text-lg font-bold text-ink">
              Sign out?
            </h3>
            <p className="mt-1 text-sm text-muted">
              You&apos;ll need to sign in again to see your bookings and credits.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 min-h-[44px] rounded-full border border-ink/10 px-4 text-sm font-semibold hover:border-ink/30 transition-colors disabled:opacity-60"
              >
                Stay signed in
              </button>
              <button
                type="button"
                onClick={signOut}
                disabled={busy}
                className="flex-1 min-h-[44px] rounded-full bg-error px-4 text-sm font-semibold text-inverse hover:bg-error/90 transition-colors disabled:opacity-70"
              >
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
