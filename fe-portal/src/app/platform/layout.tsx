import type { Metadata } from "next";
import { PlatformShell } from "@/components/platform/platform-shell";

/**
 * The super portal's own shell.
 *
 * Deliberately not `AdminShell`: that one is wrapped in `WorkspaceProvider`,
 * which loads the signed-in staff member's row, role and location grants from
 * `/portal/auth/me`. A platform admin has none of those — they belong to no
 * studio — so mounting it here would put the super portal behind a spinner
 * waiting for a request that is designed to 403.
 */
export const metadata: Metadata = {
  title: "Super portal — ReserveToday",
  description: "Create and manage the studios on the platform.",
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
