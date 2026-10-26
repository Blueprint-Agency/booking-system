import { and, asc, count, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffInvitations, staffUsers } from '../../db/schema/identity'
import { pendingStaffEmails } from '../auth/staff-email-change'
import { formatDay } from './format'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * The three ways a staff member is stuck outside the portal. All admin-only,
 * all filed under People & email, all linked to the Staff page; none can be
 * dismissed, because each clears by itself once it is dealt with.
 */
const STAFF_PAGE = '/admin/staff'
const seeAll = () => STAFF_PAGE
const adminOnly = (ctx: AttentionContext) => ctx.role === 'admin'

/**
 * An invitation past its `expires_at` and still `pending`: the rule
 * `findInvitation` (services/auth/invitations.ts) calls expired. Resending moves
 * `expires_at` forward; revoking or accepting leaves `pending`.
 */
const expiredInvitation = (ctx: AttentionContext) =>
  and(
    eq(staffInvitations.tenantId, ctx.tenantId),
    eq(staffInvitations.status, 'pending'),
    lt(staffInvitations.expiresAt, ctx.now),
  )

export const staffInvitationExpired: AttentionProvider = {
  kind: 'staff_invitation_expired',
  group: 'people_email',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => {
    const [row] = await db.select({ n: count() }).from(staffInvitations).where(expiredInvitation(ctx))
    return row?.n ?? 0
  },
  list: async (ctx, limit) => {
    const rows = await db
      .select({
        id: staffInvitations.id,
        email: staffInvitations.email,
        role: staffInvitations.role,
        expiresAt: staffInvitations.expiresAt,
        name: staffUsers.name,
      })
      .from(staffInvitations)
      .leftJoin(staffUsers, eq(staffUsers.id, staffInvitations.staffUserId))
      .where(expiredInvitation(ctx))
      .orderBy(asc(staffInvitations.expiresAt), asc(staffInvitations.id))
      .limit(limit)
    return rows.map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: null,
        occurredAt: r.expiresAt,
        title: `${r.name ?? r.email}'s invitation to join as ${r.role} expired`,
        detail: `Expired ${formatDay(r.expiresAt, ctx.timezone)}. Resend or revoke it`,
        href: `${STAFF_PAGE}?invitation=${r.id}`,
      }),
    )
  },
  seeAllHref: seeAll,
}

/**
 * Staff (not archived) whose requested new address has a confirmation link that
 * ran out. A resend replaces the link, a cancel drops it, and a confirmation
 * removes it, so each leaves this list.
 */
async function expiredEmailChanges(ctx: AttentionContext) {
  const expired = [...(await pendingStaffEmails(ctx.tenantId)).entries()].filter(([, p]) => p.expired)
  if (expired.length === 0) return []
  const people = await db
    .select({ id: staffUsers.id, name: staffUsers.name })
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, ctx.tenantId),
        ne(staffUsers.status, 'archived'),
        inArray(
          staffUsers.id,
          expired.map(([id]) => id),
        ),
      ),
    )
  const names = new Map(people.map(p => [p.id, p.name]))
  return expired
    .filter(([id]) => names.has(id))
    .map(([id, pending]) => ({ id, name: names.get(id)!, pending }))
    .sort((a, b) => a.pending.expiresAt.getTime() - b.pending.expiresAt.getTime() || a.id.localeCompare(b.id))
}

export const staffEmailChangeExpired: AttentionProvider = {
  kind: 'staff_email_change_expired',
  group: 'people_email',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => (await expiredEmailChanges(ctx)).length,
  list: async (ctx, limit) =>
    (await expiredEmailChanges(ctx)).slice(0, limit).map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: null,
        occurredAt: r.pending.expiresAt,
        title: `${r.name}'s email change to ${r.pending.email} was never confirmed`,
        detail: `The link expired ${formatDay(r.pending.expiresAt, ctx.timezone)}. Resend or cancel it`,
        href: `${STAFF_PAGE}?staff=${r.id}`,
      }),
    ),
  seeAllHref: seeAll,
}

/**
 * An active staff member on a placeholder address (the reserved `.invalid` TLD,
 * `isPlaceholderEmail` in services/auth/account-access.ts), who therefore has no
 * login to send a link to. Setting a real address or archiving them clears it.
 */
const withoutEmail = (ctx: AttentionContext) =>
  and(
    eq(staffUsers.tenantId, ctx.tenantId),
    eq(staffUsers.status, 'active'),
    sql`btrim(${staffUsers.email}) ~* '\.invalid$'`,
  )

export const staffWithoutEmail: AttentionProvider = {
  kind: 'staff_without_email',
  group: 'people_email',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => {
    const [row] = await db.select({ n: count() }).from(staffUsers).where(withoutEmail(ctx))
    return row?.n ?? 0
  },
  list: async (ctx, limit) => {
    const rows = await db
      .select({ id: staffUsers.id, name: staffUsers.name, createdAt: staffUsers.createdAt })
      .from(staffUsers)
      .where(withoutEmail(ctx))
      .orderBy(asc(staffUsers.createdAt), asc(staffUsers.id))
      .limit(limit)
    return rows.map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: null,
        occurredAt: r.createdAt,
        title: `${r.name} has no email address, so they can't sign in`,
        detail: 'Add one from Staff',
        href: `${STAFF_PAGE}?staff=${r.id}`,
      }),
    )
  },
  seeAllHref: seeAll,
}
