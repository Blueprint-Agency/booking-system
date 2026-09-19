"use client";

import { useEffect } from "react";
import { useMemberSession } from "@/lib/member-auth";
import { clearTelemetryUser, setTelemetryUser } from "@/lib/telemetry";

/**
 * Keeps the telemetry user in step with the member's session: set after sign-in,
 * cleared once signed out. Ids only (`lib/telemetry.ts`). Renders nothing.
 */
export function TelemetryUser() {
  const { isLoaded, session } = useMemberSession();
  const userId = session?.userId ?? null;
  const tenantId = session?.claimedTenantId ?? null;

  useEffect(() => {
    if (!isLoaded) return;
    if (userId) setTelemetryUser(userId, tenantId);
    else clearTelemetryUser();
  }, [isLoaded, userId, tenantId]);

  return null;
}
