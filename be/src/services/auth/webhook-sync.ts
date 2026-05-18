import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers, staffInvitations } from '../../db/schema/identity'

/**
 * Clerk user.* webhook → link to pre-seeded staff_users row.
 *
 * In v0 we don't auto-create staff_users on Clerk signups. Only pre-seeded
 * emails (superadmin today, admin invitations later) get staff status. Any
 * rogue Clerk signup creates a Clerk user with no staff row; the middleware
 * rejects them at 403.
 *
 * The client app branch is deferred to the next slice.
 */

interface ClerkWebhookUser {
  id: string
  primary_email_address_id?: string | null
  email_addresses?: Array<{ id: string; email_address: string }>
  first_name?: string | null
  last_name?: string | null
  username?: string | null
}

function primaryEmail(user: ClerkWebhookUser): string | null {
  const list = user.email_addresses ?? []
  if (user.primary_email_address_id) {
    const hit = list.find(e => e.id === user.primary_email_address_id)
    if (hit) return hit.email_address
  }
  return list[0]?.email_address ?? null
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
  | { kind: 'noop' }

export async function syncStaffFromClerk(clerkUser: ClerkWebhookUser): Promise<SyncOutcome> {
  const email = primaryEmail(clerkUser)
  if (!email) return { kind: 'noop' }
  const normalized = email.trim().toLowerCase()
  if (!normalized) return { kind: 'noop' }

  const [row] = await db
    .select()
    .from(staffUsers)
    .where(sql`lower(${staffUsers.email}) = ${normalized}`)
    .limit(1)

  if (!row) return { kind: 'no_staff_row' }

  if (row.clerkUserId && row.clerkUserId !== clerkUser.id) {
    console.warn(
      `[clerk-webhook] staff_users.id=${row.id} already linked to clerk_user_id=${row.clerkUserId}; incoming sub=${clerkUser.id} for email=${normalized}`,
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

  // Link + activate.
  const now = new Date()
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

// Backwards-compat alias for previous stub signature.
export async function handleClerkEvent(event: any, _app: 'client' | 'staff'): Promise<void> {
  if (_app === 'staff') {
    await handleClerkStaffEvent(event)
  }
  // client branch is deferred to the next slice.
}
