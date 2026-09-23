/**
 * Does the signed-in staff session belong to the studio this hostname names?
 *
 * A staff session is stamped at sign-in with the Tenant whose hostname it signed
 * in on (`claimedTenantId`), and the backend refuses it at every other studio
 * (`be/src/services/tenants/session-claim.ts`). This is the portal asking the
 * same question before it sends anything, so a session that cannot be used here
 * lands on the refusal screen straight away rather than after a request that
 * was always going to fail.
 *
 * Nothing has to *make* a session carry the right studio: a Better Auth
 * session cannot be moved between studios at all. The claim is written once,
 * at sign-in, and a staff member of two studios has a separate login at each
 * (#231), with its own sessions. So there is nothing to switch — only a
 * verdict to read.
 *
 * Normally unreachable in a browser: the session token is kept per origin, so
 * studio B's portal never holds studio A's. It is a **convenience, not a gate**;
 * the backend's claim check and Row-Level Security are the gate.
 *
 * The refusal codes are the backend's own, so `access-refusal.ts` words both
 * the same way.
 */
export type SessionTenantRefusal = "tenant_mismatch" | "tenant_required";

export function sessionTenantRefusal(input: {
  /** The studio the hostname resolved to, or null when it names none. */
  hostTenantId: string | null;
  /** The studio stamped on the session, or null when it carries none. */
  claimedTenantId: string | null;
}): SessionTenantRefusal | null {
  // No studio on this hostname: nothing to compare against, and the backend's
  // answer (`tenant_required`) is the honest one.
  if (!input.hostTenantId) return null;
  if (!input.claimedTenantId) return "tenant_required";
  return input.claimedTenantId === input.hostTenantId ? null : "tenant_mismatch";
}
