import { Suspense } from "react";
import { headers } from "next/headers";
import { AuthShell } from "@/components/auth/auth-card";
import { StaffLogin } from "@/components/auth/staff-login";
import { PlatformLogin } from "@/components/platform/platform-login";
import { isSuperPortalHost } from "@/lib/tenant-host";

/**
 * One address, two sign-ins, picked by hostname: a studio's portal signs staff
 * in through the `staff` Better Auth pool, and the super portal through Clerk
 * until #116 gives it its own pool.
 */
export default async function LoginPage() {
  const superPortal = isSuperPortalHost((await headers()).get("host"));
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <AuthShell>{superPortal ? <PlatformLogin /> : <StaffLogin />}</AuthShell>
    </Suspense>
  );
}
