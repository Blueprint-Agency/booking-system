import { RoleGate } from "@/components/auth/role-gate";
import { AdminShell } from "@/components/layout/admin-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate role="admin">
      <AdminShell variant="admin">{children}</AdminShell>
    </RoleGate>
  );
}
