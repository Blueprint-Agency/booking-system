import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers, staffInvitations, clients } from '../../db/schema/identity'
import { logger } from '../../shared/logger'

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
      await db
        .update(staffUsers)
        .set({ name, updatedAt: new Date() })
        .where(eq(staffUsers.id, row.id))
    }
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
  await db
    .update(staffUsers)
    .set({
      clerkUserId: clerkUser.id,
      status: 'active',
      name,
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

  return { kind: 'linked', staffUserId: row.id }
}

export async function handleClerkStaffEvent(event: {
  type: string
  data: ClerkWebhookUser
}): Promise<SyncOutcome> {
  if (event.type === 'user.created' || event.type === 'user.updated') {
    return syncStaffFromClerk(event.data)
  }
  return { kind: 'noop' }
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
  opts: { emailVerified?: boolean } = {},
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
  const [row] = await db
    .insert(clients)
    .values({
      clerkUserId: clerkUser.id,
      email: normalized,
      name: displayName(clerkUser) ?? normalized.split('@')[0]!,
      phone: primaryPhone(clerkUser) ?? unsafePhone(clerkUser) ?? '',
      status: 'active',
    })
    .returning({ id: clients.id })
  return { kind: 'created', clientId: row!.id }
}

export async function handleClerkClientEvent(event: {
  type: string
  data: ClerkWebhookUser
}): Promise<ClientSyncOutcome> {
  if (event.type === 'user.created' || event.type === 'user.updated') {
    return syncClientFromClerk(event.data, { emailVerified: primaryEmailVerified(event.data) })
  }
  return { kind: 'noop' }
}

// Backwards-compat alias for previous stub signature.
export async function handleClerkEvent(event: any, _app: 'client' | 'staff'): Promise<void> {
  if (_app === 'staff') {
    await handleClerkStaffEvent(event)
  } else {
    await handleClerkClientEvent(event)
  }
}
