import { headers } from "next/headers";
import { AdminShell } from "@/components/layout/admin-shell";
import { TENANT_ID_HEADER } from "@/lib/tenant-host";
import { WorkspaceProvider } from "@/lib/workspace-context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The studio this hostname resolved to, as the proxy left it on the request.
  const hostTenantId = (await headers()).get(TENANT_ID_HEADER);
  return (
    <WorkspaceProvider hostTenantId={hostTenantId}>
      <AdminShell>{children}</AdminShell>
    </WorkspaceProvider>
  );
}
