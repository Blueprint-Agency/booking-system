import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, withTenant } from '../../db'
import { staffUsers, staffInvitations, clients } from '../../db/schema/identity'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'
import { splitName } from '../../lib/name'
import { ensureStaffOrgMembership } from '../tenants/org-membership'
import { resolveTenantByClerkOrg, setTenantStatus } from '../tenants/tenants'
import {
  resolveWebhookTenants,
  tenantsHoldingStaffEmail,
  type ClerkWebhookEvent,
  type TenantResolution,
} from './webhook-tenant'

/**
 * Clerk user.* webhook → link to pre-seeded staff_users row.
 *
 * In v0 we don't auto-create staff_users on Clerk signups. Only pre-seeded
 * emails (superadmin today, admin invitations later) get staff status. Any
 * rogue Clerk signup creates a Clerk user with no staff row; the middleware
 * rejects them at 403.
 *
 * The CLIENT app branch (below) is the opposite: members are allowed to
 * self-register, so a client-app `user.created` upserts a `clients` row.
 */

interface ClerkWebhookUser {
  id: string
  primary_email_address_id?: string | null
  email_addresses?: Array<{ id: string; email_address: string; verification?: { status?: string | null } | null }>
  primary_phone_number_id?: string | null
  phone_numbers?: Array<{ id: string; phone_number: string }>
  first_name?: string | null
  last_name?: string | null
  username?: string | null
  unsafe_metadata?: { phone?: string } | null
}

function primaryPhone(user: ClerkWebhookUser): string | null {
  const list = user.phone_numbers ?? []
  if (user.primary_phone_number_id) {
    const hit = list.find(p => p.id === user.primary_phone_number_id)
    if (hit) return hit.phone_number
  }
  return list[0]?.phone_number ?? null
}

// The custom client sign-up form stashes the collected (non-SMS) phone here,
// since Clerk only stores phone numbers that are verified identifiers.
function unsafePhone(user: ClerkWebhookUser): string | null {
  const p = user.unsafe_metadata?.phone
  return p && p.trim() ? p.trim() : null
}

function primaryEmail(user: ClerkWebhookUser): string | null {
  const list = user.email_addresses ?? []
  if (user.primary_email_address_id) {
    const hit = list.find(e => e.id === user.primary_email_address_id)
    if (hit) return hit.email_address
  }
  return list[0]?.email_address ?? null
}

function primaryEmailVerified(user: ClerkWebhookUser): boolean {
  const list = user.email_addresses ?? []
  const primary = user.primary_email_address_id
    ? list.find(e => e.id === user.primary_email_address_id)
    : list[0]
  return primary?.verification?.status === 'verified'
}

function displayName(user: ClerkWebhookUser): string | null {
  const parts = [user.first_name, user.last_name].filter((p): p is string => Boolean(p && p.trim()))
  if (parts.length) return parts.join(' ').trim()
  return user.username?.trim() || null
}

export type SyncOutcome =
  | { kind: 'linked'; staffUserId: string }
  | { kind: 'idempotent'; staffUserId: string }
  | { kind: 'no_staff_row' }
  | { kind: 'email_mismatch'; staffUserId: string }
  | { kind: 'invite_expired'; staffUserId: string }
  | { kind: 'noop' }

export async function syncStaffFromClerk(clerkUser: ClerkWebhookUser): Promise<SyncOutcome> {
  const email = primaryEmail(clerkUser)
  if (!email) return { kind: 'noop' }
  const normalized = email.trim().toLowerCase()
  if (!normalized) return { kind: 'noop' }

  const [row] = await db
    .select()
    .from(staffUsers)
    .where(and(sql`lower(${staffUsers.email}) = ${normalized}`, isNull(staffUsers.deletedAt)))
    .limit(1)

  if (!row) return { kind: 'no_staff_row' }

  if (row.clerkUserId && row.clerkUserId !== clerkUser.id) {
    logger.warn(
      {
        staffUserId: row.id,
        existingClerkUserId: row.clerkUserId,
        incomingSub: clerkUser.id,
        email: normalized,
      },
      'clerk-webhook: staff_users row already linked to a different clerk_user_id',
    )
    return { kind: 'email_mismatch', staffUserId: row.id }
  }

  if (row.clerkUserId === clerkUser.id && row.status === 'active') {
    // Already linked — sync name on user.updated.
    const name = displayName(clerkUser)
    if (name && name !== row.name) {
      const { firstName, lastName } = splitName(name)
      await db
        .update(staffUsers)
        .set({ name, firstName, lastName, updatedAt: new Date() })
        .where(eq(staffUsers.id, row.id))
    }
    // Re-asserted on every pass, not only the linking one: a grant that failed
    // when the row was first linked heals here the next time the person signs
    // in, and staff linked before organizations existed pick theirs up.
    await ensureStaffOrgMembership({ tenantId: row.tenantId, clerkUserId: clerkUser.id, role: row.role })
    return { kind: 'idempotent', staffUserId: row.id }
  }

  const now = new Date()

  // Invitation-validity gate. If this row has a matching pending invitation that
  // has lapsed, refuse to activate — leave BOTH the invitation (still 'pending')
  // and the staff row ('pending') untouched, so requireActiveStaff keeps 403ing
  // while the invite stays visible/resendable. A resend extends expires_at and
  // the next sign-in re-runs this gate and succeeds. No invitation row at all
  // (seeded superadmin / legacy createInstructor path) means nothing to expire,
  // so activation proceeds as before.
  const [pendingInv] = await db
    .select()
    .from(staffInvitations)
    .where(
      and(
        eq(staffInvitations.staffUserId, row.id),
        eq(staffInvitations.status, 'pending'),
      ),
    )
    .limit(1)
  if (pendingInv && pendingInv.expiresAt.getTime() < now.getTime()) {
    logger.warn(
      {
        staffUserId: row.id,
        invitationExpiresAt: pendingInv.expiresAt.toISOString(),
      },
      'clerk-webhook: refusing to activate staff user, invitation expired (resend to extend)',
    )
    return { kind: 'invite_expired', staffUserId: row.id }
  }

  // Link + activate.
  const name = displayName(clerkUser) ?? row.name
  const { firstName, lastName } = splitName(name)
  await db
    .update(staffUsers)
    .set({
      clerkUserId: clerkUser.id,
      status: 'active',
      name,
      firstName,
      lastName,
      acceptedAt: row.acceptedAt ?? now,
      updatedAt: now,
    })
    .where(eq(staffUsers.id, row.id))

  // If this row came from an admin invitation, mark that invitation accepted.
  // (Superadmin seed has no matching invitation — the update is a no-op then.)
  await db
    .update(staffInvitations)
    .set({ status: 'accepted', acceptedAt: now, staffUserId: row.id })
    .where(
      and(
        eq(staffInvitations.staffUserId, row.id),
        eq(staffInvitations.status, 'pending'),
      ),
    )

  // The row now says which studio and Clerk now has a user id: the first moment
  // a membership can be granted, and the only thing between this person and a
  // token that carries the organization claim the portal requires.
  await ensureStaffOrgMembership({ tenantId: row.tenantId, clerkUserId: clerkUser.id, role: row.role })

  return { kind: 'linked', staffUserId: row.id }
}

/**
 * Turn one Clerk event into the user payload the sync functions take.
 *
 * `user.*` events carry the profile directly. An `organizationMembership.*`
 * event carries only `public_user_data` — a user id, a display name and the
 * `identifier`, which for these applications is the email address. That is
 * exactly enough to link a pre-seeded staff row or create a member's row, and
 * the next `user.updated` fills in the rest.
 */
function userFromEvent(event: ClerkWebhookEvent): ClerkWebhookUser | null {
  const data = event.data ?? {}
  if (event.type.startsWith('user.')) return data as ClerkWebhookUser

  const person = data.public_user_data
  if (!person?.user_id) return null
  const identifier = typeof person.identifier === 'string' ? person.identifier : null
  return {
    id: person.user_id,
    primary_email_address_id: identifier ? 'membership' : null,
    // No verification status, deliberately. `identifier` is a display string —
    // it says what the person signed up as, not that Clerk confirmed they own
    // it — and `syncClientFromClerk` gates re-linking an EXISTING row by email
    // on exactly that flag. Asserting it here would turn a membership event into
    // a way to take over somebody else's record by address alone. Unverified,
    // the conflict is refused and logged instead.
    email_addresses: identifier ? [{ id: 'membership', email_address: identifier }] : [],
    first_name: person.first_name ?? null,
    last_name: person.last_name ?? null,
  }
}

/** The events either application acts on. Everything else is a logged no-op. */
const ACTED_ON = new Set([
  'user.created',
  'user.updated',
  'organizationMembership.created',
  'organizationMembership.updated',
])

export type StaffEventOutcome =
  | SyncOutcome
  | { kind: 'unresolved_tenant'; reason: string }
  | { kind: 'organization_deleted'; tenantId: string }

/**
 * The studio's organization was deleted in the Clerk dashboard.
 *
 * Every staff token for that studio now carries no claim, and `orgClaimVerdict`
 * refuses each one with `organization_required` — the studio is closed, and
 * without this nothing would have said so. The stale id is deliberately
 * **kept** on the row: clearing it would flip the rollout seam back to
 * "enforcement not switched on yet" and let claim-less tokens through, which
 * is the worst reading of the same event. Suspending the studio says what
 * happened; putting it back is an operator's decision, with a new organization.
 *
 * Runs outside any Tenant context, as the route does: `tenants` carries no
 * policy and `setTenantStatus` is the same call the super portal makes.
 */
async function handleOrganizationDeleted(
  event: ClerkWebhookEvent,
): Promise<StaffEventOutcome> {
  const tenant = await resolveTenantByClerkOrg('portal', String(event.data?.id ?? ''))
  // Unknown, or already archived: nothing to close.
  if (!tenant) return { kind: 'unresolved_tenant', reason: 'unknown_organization' }
  if (tenant.status !== 'active') return { kind: 'noop' }

  await setTenantStatus(tenant.id, 'suspended')
  const err = new Error('clerk organization deleted for an active tenant — studio suspended')
  logger.error(
    { tenantId: tenant.id, slug: tenant.slug, organizationId: tenant.clerkPortalOrgId },
    err.message,
  )
  captureException(err, { scope: 'clerk-organization-deleted', tenantId: tenant.id, slug: tenant.slug })
  return { kind: 'organization_deleted', tenantId: tenant.id }
}

export async function handleClerkStaffEvent(event: ClerkWebhookEvent): Promise<StaffEventOutcome> {
  if (event.type === 'organization.deleted') return handleOrganizationDeleted(event)
  if (!ACTED_ON.has(event.type)) return { kind: 'noop' }

  const clerkUser = userFromEvent(event)
  if (!clerkUser) return { kind: 'noop' }

  const tenants = await resolveStaffEventTenants(event, clerkUser)
  if (tenants.kind === 'unresolved') {
    logger.warn(
      { eventType: event.type, reason: tenants.reason },
      'clerk-webhook: staff event names no tenant — ignored',
    )
    return { kind: 'unresolved_tenant', reason: tenants.reason }
  }

  // A person may be staff at two studios; the event updates their row at each.
  // The last outcome wins as the reported one, which is only ever a log line.
  let outcome: SyncOutcome = { kind: 'noop' }
  for (const tenantId of tenants.tenantIds) {
    outcome = await withTenant(tenantId, () => syncStaffFromClerk(clerkUser))
  }
  return outcome
}

/**
 * Staff resolution has one extra source the member side does not have: staff
 * rows are always pre-seeded or invited, never self-registered, so an email that
 * already exists in `staff_users` names the studio that invited it. That is a
 * membership fact, not a guess — which is what lets an invitation accepted
 * before the Clerk organization exists still link.
 */
async function resolveStaffEventTenants(
  event: ClerkWebhookEvent,
  clerkUser: ClerkWebhookUser,
): Promise<TenantResolution> {
  const resolution = await resolveWebhookTenants('portal', event)
  if (resolution.kind === 'resolved' || resolution.reason !== 'no_tenant_named') {
    return resolution
  }

  const email = primaryEmail(clerkUser)
  if (!email) return resolution
  const tenantIds = await tenantsHoldingStaffEmail(email.trim().toLowerCase())
  return tenantIds.length
    ? { kind: 'resolved', tenantIds, source: 'existing_rows' }
    : resolution
}

// ---------------------------------------------------------------------------
// Client app sync — members self-register, so user.created upserts a clients row.
// Admin-created clients already have a row (we set clerk_user_id at createUser
// time), so their webhook lands as `idempotent`/`updated` rather than `created`.
// ---------------------------------------------------------------------------

export type ClientSyncOutcome =
  | { kind: 'created'; clientId: string }
  | { kind: 'updated'; clientId: string }
  | { kind: 'idempotent'; clientId: string }
  | { kind: 'email_conflict' }
  | { kind: 'noop' }

export async function syncClientFromClerk(
  clerkUser: ClerkWebhookUser,
  opts: { tenantId: string; emailVerified?: boolean },
): Promise<ClientSyncOutcome> {
  const email = primaryEmail(clerkUser)
  if (!email) return { kind: 'noop' }
  const normalized = email.trim().toLowerCase()
  if (!normalized) return { kind: 'noop' }

  // Already linked by clerk_user_id → keep name/phone in sync, otherwise no-op.
  const [byClerk] = await db
    .select()
    .from(clients)
    .where(eq(clients.clerkUserId, clerkUser.id))
    .limit(1)
  if (byClerk) {
    const name = displayName(clerkUser)
    const phone = primaryPhone(clerkUser)
    const set: Partial<typeof clients.$inferInsert> = {}
    if (name && name !== byClerk.name) set.name = name
    if (phone && phone !== byClerk.phone) set.phone = phone
    if (Object.keys(set).length) {
      set.updatedAt = new Date()
      await db.update(clients).set(set).where(eq(clients.id, byClerk.id))
      return { kind: 'updated', clientId: byClerk.id }
    }
    return { kind: 'idempotent', clientId: byClerk.id }
  }

  // A clients row with this email but a *different* clerk_user_id happens when a
  // member is deleted in Clerk and signs up again: Clerk mints a fresh user id,
  // the row keeps the stale one, and every authed request then 404s
  // `client_not_found`. Re-link the row to the new identity — but only when the
  // incoming email is verified and the row isn't soft-deleted, so this can't be
  // abused as an email-based account takeover or resurrect a banned member.
  const [byEmail] = await db
    .select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients)
    .where(sql`lower(${clients.email}) = ${normalized}`)
    .limit(1)
  if (byEmail) {
    if (opts.emailVerified && !byEmail.deletedAt) {
      const name = displayName(clerkUser)
      const phone = primaryPhone(clerkUser) ?? unsafePhone(clerkUser)
      const set: Partial<typeof clients.$inferInsert> = {
        clerkUserId: clerkUser.id,
        updatedAt: new Date(),
      }
      if (name) set.name = name
      if (phone) set.phone = phone
      await db.update(clients).set(set).where(eq(clients.id, byEmail.id))
      logger.info(
        { clientId: byEmail.id, email: normalized, incomingSub: clerkUser.id },
        'clerk-webhook: re-linked clients row to new clerk_user_id',
      )
      return { kind: 'updated', clientId: byEmail.id }
    }
    logger.warn(
      {
        clientId: byEmail.id,
        email: normalized,
        incomingSub: clerkUser.id,
      },
      'clerk-webhook: clients row exists with a different clerk_user_id',
    )
    return { kind: 'email_conflict' }
  }

  // Self-registration: create the client row from the Clerk profile.
  //
  // The tenant is the caller's to supply, and it is required rather than
  // defaulted — every path into here now knows it for a reason the caller can
  // point at: an authenticated request resolved it and had it checked against
  // the browser's own `Origin`, or a Clerk organization event named it. A
  // default here would be the one place all of that could be bypassed.
  //
  // The lookups above are scoped by the Tenant context this runs inside
  // (migration 0033), which is also what makes the same person's row at another
  // studio invisible to this one — they are two rows, and each belongs to its
  // own studio (migration 0035).
  const [row] = await db
    .insert(clients)
    .values({
      tenantId: opts.tenantId,
      clerkUserId: clerkUser.id,
      email: normalized,
      name: displayName(clerkUser) ?? normalized.split('@')[0]!,
      phone: primaryPhone(clerkUser) ?? unsafePhone(clerkUser) ?? '',
      status: 'active',
    })
    .returning({ id: clients.id })
  return { kind: 'created', clientId: row!.id }
}

export type ClientEventOutcome = ClientSyncOutcome | { kind: 'unresolved_tenant'; reason: string }

export async function handleClerkClientEvent(
  event: ClerkWebhookEvent,
): Promise<ClientEventOutcome> {
  if (!ACTED_ON.has(event.type)) return { kind: 'noop' }

  const clerkUser = userFromEvent(event)
  if (!clerkUser) return { kind: 'noop' }

  const resolution = await resolveWebhookTenants('client', event)
  if (resolution.kind === 'unresolved') {
    // Not an error, and deliberately not a 500: a member who signed up without
    // an organization or a `tenant_slug` gets their row on their first
    // authenticated request instead (middleware/clerk-client.ts), from a
    // Tenant that request proved rather than one this endpoint guessed.
    logger.warn(
      { eventType: event.type, reason: resolution.reason },
      'clerk-webhook: client event names no tenant — deferred to first authenticated request',
    )
    return { kind: 'unresolved_tenant', reason: resolution.reason }
  }

  // One member, possibly two studios: their record at each is independent, so
  // each is synced in its own Tenant context.
  const emailVerified = primaryEmailVerified(clerkUser)
  let outcome: ClientSyncOutcome = { kind: 'noop' }
  for (const tenantId of resolution.tenantIds) {
    outcome = await withTenant(tenantId, () =>
      syncClientFromClerk(clerkUser, { tenantId, emailVerified }),
    )
  }
  return outcome
}
