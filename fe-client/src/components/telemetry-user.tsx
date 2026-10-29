"use client";

import { useEffect } from "react";
import { useMemberSessionQuiet } from "@/lib/member-auth";
import { clearTelemetryUser, setTelemetryUser } from "@/lib/telemetry";

/**
 * Keeps the telemetry user in step with the member's session: set after sign-in,
 * cleared once signed out. Ids only (`lib/telemetry.ts`). Renders nothing.
 *
 * It sits in the root layout, outside the route's error boundary, so it reads
 * the session without throwing: a session the app could not read is the
 * pages' to show as an error, not the whole app's. It identifies nobody then.
 */
export function TelemetryUser() {
  const { isLoaded, session } = useMemberSessionQuiet();
  const userId = session?.userId ?? null;
  const tenantId = session?.claimedTenantId ?? null;

  useEffect(() => {
    if (!isLoaded) return;
    if (userId) setTelemetryUser(userId, tenantId);
    else clearTelemetryUser();
  }, [isLoaded, userId, tenantId]);

  return null;
}
