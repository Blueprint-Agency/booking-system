import { InstructorShell } from "@/components/layout/instructor-shell";
import { WorkspaceProvider } from "@/lib/workspace-context";

export default function InstructorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <InstructorShell>{children}</InstructorShell>
    </WorkspaceProvider>
  );
}
