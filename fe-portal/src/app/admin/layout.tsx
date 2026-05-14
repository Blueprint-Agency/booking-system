import { AdminShell } from "@/components/layout/admin-shell";
import { WorkspaceProvider } from "@/lib/workspace-context";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AdminShell>{children}</AdminShell>
    </WorkspaceProvider>
  );
}
