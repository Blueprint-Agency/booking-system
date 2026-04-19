import { RoleGate } from "@/components/auth/role-gate";
import { AdminShell } from "@/components/layout/admin-shell";

export default function SuperLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate role="super">
      <AdminShell variant="super">{children}</AdminShell>
    </RoleGate>
  );
}
