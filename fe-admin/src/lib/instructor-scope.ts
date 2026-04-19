"use client";

import { useAdminState } from "@/lib/admin-state";

/** Resolve the current AdminUser to a matching instructor record (by email). */
export function useMyInstructorId(): string | null {
  return useAdminState((s) => {
    const uid = s.auth.userId;
    if (!uid) return null;
    const user = s.adminUsers.find((u) => u.id === uid);
    if (!user) return null;
    const inst = s.instructors.find(
      (i) => i.email.toLowerCase() === user.email.toLowerCase() && i.tenantId === user.tenantId,
    );
    return inst?.id ?? null;
  });
}
