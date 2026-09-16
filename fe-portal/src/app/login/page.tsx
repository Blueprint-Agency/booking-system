import { Suspense } from "react";
import { headers } from "next/headers";
import { AuthShell } from "@/components/auth/auth-card";
import { PortalLogin } from "@/components/auth/portal-login";
import { isSuperPortalHost } from "@/lib/tenant-host";

/**
 * One address, one form, two pools picked by hostname: a studio's portal signs
 * staff in through the `staff` Better Auth pool, and the super portal operators
 * through the `platform` pool (`lib/auth-pool.ts`).
 */
export default async function LoginPage() {
  const superPortal = isSuperPortalHost((await headers()).get("host"));
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <AuthShell>
        <PortalLogin superPortal={superPortal} />
      </AuthShell>
    </Suspense>
  );
}
