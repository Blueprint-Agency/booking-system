"use client";
import { Button } from "@/components/ui";
import { useAdminState } from "@/lib/admin-state";
import { stopImpersonation, useCurrentUser } from "@/lib/admin-auth";

export function ImpersonateBanner() {
  const originatorId = useAdminState((s) => s.auth.originatorUserId);
  const effectiveUser = useCurrentUser();
  if (!originatorId) return null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between bg-warning px-6 py-2 text-sm font-medium text-ink">
      <span>
        Super-admin viewing as <strong>{effectiveUser?.name ?? "—"}</strong> — all actions are
        audit-logged with originator.
      </span>
      <Button size="sm" variant="secondary" onClick={() => stopImpersonation()}>
        Stop
      </Button>
    </div>
  );
}
