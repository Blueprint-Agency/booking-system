"use client";
import { useMemo } from "react";
import { PageHeader } from "@/components/ui";
import { MaintenanceCard } from "@/components/platform/maintenance-card";
import { makeApi } from "@/lib/api";
import { getPortalToken } from "@/lib/portal-auth";

/**
 * Maintenance mode, on its own page rather than above the studio list: it is
 * about the whole platform, not any one studio, and switched around deploys.
 */
export default function MaintenancePage() {
  const api = useMemo(() => makeApi(getPortalToken), []);
  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Close every studio’s member app and portal while the platform is being worked on."
      />
      <MaintenanceCard api={api} />
    </>
  );
}
