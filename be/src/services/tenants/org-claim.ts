/**
 * The Clerk Organization claim, and what it is allowed to say.
 *
 * Each Tenant is one Clerk Organization in the **portal** application, and the
 * organization id is stored on the Tenant row (`clerk_portal_org_id`). The
 * client application has none: a studio has hundreds of members, Clerk prices
 * organization membership per seat, and members are scoped by hostname +
 * `Origin` and fenced by Row-Level Security instead — so `clerk_client_org_id`
 * is null on every Tenant and stays null. See
 * `docs/adr/0003-no-client-side-clerk-organizations.md`.
 *
 * A session token minted for a signed-in user carries
 * the organization it is *active in*, which is the only statement about tenancy
 * on the request that the caller cannot forge — `X-Tenant-Slug` is set by our
 * own proxy, but a proxy is a header away from being impersonated, and the
 * organization claim is inside a signature.
 *
 * So the header is resolved and the claim is what confirms it.
 */

export type OrgClaimVerdict = 'ok' | 'tenant_mismatch' | 'organization_required'

/**
 * Two shapes, because Clerk changed one. Session token v2 nests the active
 * organization under `o` (`o.id`, `o.slg`, `o.rol`); v1 flattens it as
 * `org_id` / `org_slug` / `org_role`. Both are read so a token minted by either
 * version of the front end is understood.
 */
export function orgIdFromClaims(claims: unknown): string | null {
  if (!claims || typeof claims !== 'object') return null
  const record = claims as Record<string, unknown>

  const nested = record.o
  if (nested && typeof nested === 'object') {
    const id = (nested as Record<string, unknown>).id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }

  const flat = record.org_id
  if (typeof flat === 'string' && flat.trim()) return flat.trim()

  return null
}

/**
 * Does the organization on the token agree with the Tenant the request claims?
 *
 * - **A claim that resolves to another Tenant, or to none at all, is refused.**
 *   "None at all" is an organization this platform has never heard of, and
 *   trusting it would make the check decorative.
 * - **No claim is allowed only while the Tenant has no organization
 *   configured.** For the portal that is the rollout seam, and it is
 *   deliberately one-way: the moment a Tenant's organization id is written to
 *   its row, tokens without the claim stop working for it, and nothing has to be
 *   redeployed to turn enforcement on. For the client application it is the
 *   permanent state — `clerk_client_org_id` is never written — so every member
 *   token takes this branch, and writing an id there would lock a studio's
 *   entire membership out.
 */
export function orgClaimVerdict(input: {
  /** The Tenant the request resolved to, from `X-Tenant-Slug`. */
  requestTenantId: string
  /** That Tenant's organization id for THIS Clerk application, or null. */
  configuredOrgId: string | null
  /** The organization id on the verified token, or null. */
  claimedOrgId: string | null
  /** The Tenant that claimed organization belongs to, or null if unknown. */
  claimedOrgTenantId: string | null
}): OrgClaimVerdict {
  if (input.claimedOrgId) {
    return input.claimedOrgTenantId === input.requestTenantId ? 'ok' : 'tenant_mismatch'
  }
  return input.configuredOrgId ? 'organization_required' : 'ok'
}
