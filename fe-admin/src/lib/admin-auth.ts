"use client";
import { useAdminState, setState, STUDIO_TENANT_ID } from "./admin-state";
import type { AdminRole, AdminUser } from "@/types";

/**
 * Returns the *effective* user — i.e. the impersonated user during impersonation,
 * otherwise the signed-in user.
 */
export function useCurrentUser(): AdminUser | null {
  return useAdminState((s) =>
    s.auth.userId ? s.adminUsers.find((u) => u.id === s.auth.userId) ?? null : null
  );
}

export function useCurrentRole(): AdminRole | null {
  return useAdminState((s) => {
    const u = s.auth.userId ? s.adminUsers.find((x) => x.id === s.auth.userId) : null;
    return u?.role ?? null;
  });
}

/** Single-studio: tenant id is a constant. Kept as a stable reference for cross-app keys. */
export function useCurrentTenantId(): string {
  return STUDIO_TENANT_ID;
}

/** Originator user id when impersonating, else null. */
export function useOriginatorUserId(): string | null {
  return useAdminState((s) => s.auth.originatorUserId);
}

export function useIsImpersonating(): boolean {
  return useAdminState((s) => s.auth.originatorUserId !== null);
}

export function useOriginatorUser(): AdminUser | null {
  return useAdminState((s) =>
    s.auth.originatorUserId
      ? s.adminUsers.find((u) => u.id === s.auth.originatorUserId) ?? null
      : null
  );
}

export function signInAs(userId: string) {
  setState((s) => ({ ...s, auth: { userId, originatorUserId: null } }));
}

export function signOut() {
  setState((s) => ({ ...s, auth: { userId: null, originatorUserId: null } }));
}

/**
 * Super-admin starts impersonating a studio admin: the effective user becomes the target,
 * the originator is preserved so we can return on stop.
 */
export function startImpersonation(targetUserId: string) {
  setState((s) => ({
    ...s,
    auth: {
      userId: targetUserId,
      originatorUserId: s.auth.userId,
    },
  }));
}

export function stopImpersonation() {
  setState((s) => ({
    ...s,
    auth: {
      userId: s.auth.originatorUserId,
      originatorUserId: null,
    },
  }));
}
