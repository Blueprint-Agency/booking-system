"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { startImpersonation, useCurrentUser } from "@/lib/admin-auth";
import { PageHeader, Avatar, Button } from "@/components/ui";

export default function ImpersonatePage() {
  const router = useRouter();
  const me = useCurrentUser();
  const adminUsers = useAdminState((s) => s.adminUsers);
  const admins = useMemo(() => adminUsers.filter((u) => u.role === "admin"), [adminUsers]);
  const instructors = useMemo(
    () => adminUsers.filter((u) => u.role === "instructor"),
    [adminUsers],
  );

  const begin = (userId: string) => {
    startImpersonation(userId);
    router.push("/");
  };

  const isSuper = me?.role === "super";

  return (
    <>
      <PageHeader
        title="Impersonate"
        description="View the app as a studio-admin or instructor. Banner persists; all actions are audit-logged with the originator."
      />
      {!isSuper && (
        <div className="mt-6 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          Sign in as super-admin to use impersonation.
        </div>
      )}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Studio admins" rows={admins} canImpersonate={isSuper} onPick={begin} />
        <Section title="Instructors" rows={instructors} canImpersonate={isSuper} onPick={begin} />
      </div>
    </>
  );
}

interface SectionRow {
  id: string;
  name: string;
  email: string;
}

function Section({
  title,
  rows,
  canImpersonate,
  onPick,
}: {
  title: string;
  rows: SectionRow[];
  canImpersonate: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">None.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-3">
                <Avatar name={u.name} size={32} />
                <div>
                  <div className="text-sm font-medium text-ink">{u.name}</div>
                  <div className="text-xs text-muted">{u.email}</div>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!canImpersonate}
                onClick={() => onPick(u.id)}
              >
                <UserCheck className="mr-1 h-3 w-3" /> Impersonate
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
