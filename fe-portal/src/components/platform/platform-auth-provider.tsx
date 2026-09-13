import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { portalPublishableKey } from "@/lib/clerk-keys";
import { portalHomePath } from "@/lib/super-portal";

/**
 * Clerk, for the super portal only — until #116 moves it to the `platform`
 * Better Auth pool. A studio's portal signs in through Better Auth and mounts
 * none of this (`app/layout.tsx`).
 *
 * Server-side: `portalPublishableKey` lives beside a secret, and must not reach
 * a client bundle.
 */
export function PlatformAuthProvider({
  host,
  children,
}: {
  host: string | null;
  children: ReactNode;
}) {
  // A fallback rather than a force: the force variant wins over the `?next=`
  // the proxy set on its way to the login page, which is the only record of
  // where the operator was actually going.
  const home = portalHomePath(true);
  return (
    <ClerkProvider
      // The super portal's own Clerk application when one is configured, so its
      // session is not a studio portal's. Unset falls back to the ambient key.
      // The server-side half of this split is `lib/platform-proxy.ts`; both read
      // `lib/clerk-keys.ts` so they cannot disagree.
      publishableKey={portalPublishableKey(host)}
      signInUrl="/login"
      signInFallbackRedirectUrl={home}
      signUpFallbackRedirectUrl={home}
    >
      {children}
    </ClerkProvider>
  );
}
