import { RoleGate } from "@/components/auth/role-gate";
import { AdminShell } from "@/components/layout/admin-shell";

export default function InstructorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate role="instructor">
      <AdminShell variant="instructor">{children}</AdminShell>
    </RoleGate>
  );
}
