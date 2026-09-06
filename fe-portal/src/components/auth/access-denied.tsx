"use client";
import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { StudioMark } from "@/components/brand/studio-mark";
import { accessDeniedCopy } from "@/lib/access-refusal";
import { reportError } from "@/lib/report-error";

/**
 * The portal's answer to a refused session.
 *
 * Why this is a screen rather than a redirect is in `lib/access-refusal.ts`.
 * What matters here is that it names the account: the exit from the loop is
 * the person seeing *which* of their two accounts the browser is holding, and
 * a message that did not say so would leave them clicking sign-in again.
 *
 * This replaces the whole shell, so its buttons are the only way out of it.
 * That is why both of them are written to survive their own failure rather
 * than leaving a disabled spinner and a hard reload.
 */
export function AccessDenied({
  email,
  reason,
  onRetry,
}: {
  email: string | null;
  reason: string | null;
  onRetry: () => void;
}) {
  const { signOut } = useClerk();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const copy = accessDeniedCopy(reason);

  async function switchAccount() {
    setLeaving(true);
    setSignOutFailed(false);
    try {
      await signOut(() => router.push("/login"));
    } catch (err) {
      // Offline, or Clerk is unwell. Without this the button would stay
      // disabled behind a spinner forever, and this screen has no other exit.
      reportError(err, { scope: "access-denied-sign-out" });
      setSignOutFailed(true);
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <StudioMark size="auth" badge="Staff" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-soft">
          <h1 className="text-base font-semibold text-ink">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {!copy.namesAccount ? (
              copy.detail
            ) : email ? (
              <>
                You&apos;re signed in as{" "}
                <span className="font-medium text-ink">{email}</span>, which{" "}
                {copy.detail}
              </>
            ) : (
              <>The account you&apos;re signed in as {copy.detail}</>
            )}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {copy.offerRetry && (
              <Button
                onClick={onRetry}
                // Primary when it is the only way forward — a suspended studio
                // offers no account to switch to.
                variant={copy.offerSwitch ? "secondary" : "primary"}
                className="w-full"
              >
                Try again
              </Button>
            )}
            {copy.offerSwitch && (
              <Button
                onClick={switchAccount}
                disabled={leaving}
                className="w-full"
              >
                {leaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign out and use another account
              </Button>
            )}
          </div>
          {signOutFailed && (
            <p className="mt-3 text-xs text-error">
              We couldn&apos;t sign you out. Check your connection and try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
