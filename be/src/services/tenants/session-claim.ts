/**
 * The Better Auth session claim, and what it is allowed to say.
 *
 * A studio-pool session (`client` or `staff`) is created on a studio's hostname,
 * inside the Tenant context `resolveTenant` opened, and the session-create hook
 * in `services/auth/better-auth.ts` writes that Tenant's id onto the row as
 * `claimed_tenant_id`. The row is ours and the token that names it is signed, so
 * the claim is a statement about tenancy the caller cannot forge — the job the
 * Clerk Organization claim does for the portal (`./org-claim.ts`), now on both
 * the portal and the member side, which ADR 0003 said Clerk could not afford.
 *
 * So the header is resolved and the session is what confirms it. A session from
 * studio A is worthless at studio B.
 */

export type SessionClaimVerdict = 'ok' | 'tenant_mismatch' | 'tenant_required'

export function sessionClaimVerdict(input: {
  /** The Tenant the request resolved to, from `X-Tenant-Slug` / `Origin`. */
  requestTenantId: string
  /** The Tenant stamped on the session at sign-in, or null. */
  claimedTenantId: string | null
}): SessionClaimVerdict {
  if (!input.claimedTenantId) return 'tenant_required'
  return input.claimedTenantId === input.requestTenantId ? 'ok' : 'tenant_mismatch'
}
