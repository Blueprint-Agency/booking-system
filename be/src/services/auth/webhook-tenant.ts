import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { normaliseSlug } from '../tenants/slug'
import { resolveTenantByClerkOrg, resolveTenantBySlug } from '../tenants/tenants'

/**
 * Which Tenant is a Clerk webhook about?
 *
 * The decision, recorded in full in `docs/md/spec-tenant-resolution.md`:
 * **the Clerk Organization is the authority, and `user.*` events are identity
 * only.** A `user.created` payload carries no organization, so it genuinely
 * cannot say which studio someone is joining — and guessing (tenant #1, "the
 * only one that exists", the first row that matches the email) is how one
 * studio's member ends up filed under another's.
 *
 * Three sources are consulted, in this order, and each is a different kind of
 * evidence rather than a fallback for the same one:
 *
 *  1. **The organization on the event.** `organizationMembership.created` says
 *     exactly which studio a person just joined, in a payload Clerk signed.
 *     This is the only source that can create a row.
 *  2. **A `tenant_slug` in the user's metadata**, set by the front end at
 *     sign-up. Present only when the sign-up form ran on a tenant subdomain and
 *     said so, which makes it a statement about intent rather than membership.
 *  3. **The Tenants that already hold a row for this Clerk user.** This is what
 *     makes `user.updated` work for a person in two studios: they have two rows
 *     and both get the new name. It can never create one.
 *
 * When none of the three answers, the event is a no-op — deliberately, and
 * loudly. A member who signs up with no organization and no metadata gets their
 * row on their first authenticated request instead, from `clerk-client.ts`,
 * which knows the Tenant the request resolved to and had that Tenant checked
 * against the caller's own `Origin`. That path is the one that already carries
 * production today; the webhook is an accelerator, not the only door.
 */

export type ClerkWebhookEvent = { type: string; data: Record<string, any> }

export type TenantHints = {
  /** The Clerk organization the event names, if it is an organization event. */
  organizationId: string | null
  /** A `tenant_slug` the front end stamped on the user at sign-up. */
  metadataSlug: string | null
  /** The Clerk user the event is about, whichever shape the event uses. */
  clerkUserId: string | null
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/** Pure: read the three hints off an event, without deciding anything. */
export function tenantHints(event: ClerkWebhookEvent): TenantHints {
  const data = event.data ?? {}
  const type = event.type ?? ''

  // `organization.*` is about the organization itself, so the id is the row's;
  // every membership/invitation event nests it.
  const organizationId = type.startsWith('organization.')
    ? str(data.id)
    : str(data.organization?.id)

  const metadataSlug =
    str(data.public_metadata?.tenant_slug) ?? str(data.unsafe_metadata?.tenant_slug)

  // `user.*` is about the user directly; a membership event names them under
  // `public_user_data`.
  const clerkUserId = type.startsWith('user.')
    ? str(data.id)
    : str(data.public_user_data?.user_id) ?? str(data.user_id)

  return {
    organizationId,
    metadataSlug: metadataSlug ? normaliseSlug(metadataSlug) : null,
    clerkUserId,
  }
}

export type TenantResolution =
  | { kind: 'resolved'; tenantIds: string[]; source: 'organization' | 'metadata' | 'existing_rows' }
  | {
      kind: 'unresolved'
      reason: 'unknown_organization' | 'unknown_slug' | 'no_tenant_named'
    }

/**
 * The cross-tenant lookup the application role is not allowed to do directly.
 *
 * Migration 0035 exposes it as a `SECURITY DEFINER` function returning ids and
 * no row data — the same shape migration 0034 used for the payment provider, and
 * for the same reason: a webhook arrives with no Tenant context, so the question
 * "whose is this?" is exactly the read the policies refuse.
 */
async function tenantsHoldingClerkUser(app: 'client' | 'portal', clerkUserId: string) {
  const fn =
    app === 'client'
      ? sql`public.tenants_for_clerk_client_user(${clerkUserId})`
      : sql`public.tenants_for_clerk_staff_user(${clerkUserId})`
  const rows = await db.execute<{ tenant_id: string }>(
    sql`SELECT ${fn} AS tenant_id`,
  )
  return [...rows].map(row => row.tenant_id).filter(Boolean)
}

/** The same question asked by email, which is all a staff payload carries. */
export async function tenantsHoldingStaffEmail(email: string): Promise<string[]> {
  const rows = await db.execute<{ tenant_id: string }>(
    sql`SELECT public.tenants_for_staff_email(${email}) AS tenant_id`,
  )
  return [...rows].map(row => row.tenant_id).filter(Boolean)
}

export async function resolveWebhookTenants(
  app: 'client' | 'portal',
  event: ClerkWebhookEvent,
): Promise<TenantResolution> {
  const hints = tenantHints(event)

  if (hints.organizationId) {
    const tenant = await resolveTenantByClerkOrg(app, hints.organizationId)
    // An organization this platform does not know is not a reason to fall
    // through to a weaker signal — it is a reason to stop. Falling through
    // would let a stray metadata slug decide an event that named a studio.
    return tenant
      ? { kind: 'resolved', tenantIds: [tenant.id], source: 'organization' }
      : { kind: 'unresolved', reason: 'unknown_organization' }
  }

  if (hints.metadataSlug) {
    const resolved = await resolveTenantBySlug(hints.metadataSlug)
    return resolved
      ? { kind: 'resolved', tenantIds: [resolved.tenant.id], source: 'metadata' }
      : { kind: 'unresolved', reason: 'unknown_slug' }
  }

  if (hints.clerkUserId) {
    const tenantIds = await tenantsHoldingClerkUser(app, hints.clerkUserId)
    if (tenantIds.length) {
      return { kind: 'resolved', tenantIds, source: 'existing_rows' }
    }
  }

  return { kind: 'unresolved', reason: 'no_tenant_named' }
}
