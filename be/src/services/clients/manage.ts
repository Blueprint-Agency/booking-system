import { and, desc, eq, getTableColumns, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { clientPackages } from '../../db/schema/packages'
import { bookings } from '../../db/schema/bookings'
import { manualAdjustments } from '../../db/schema/ledger'
import { getClerkClientApp } from '../../lib/clerk'
import { requireTenantUrl } from '../tenants/urls'
import { sendTemplatedEmail } from '../notifications/send'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { logger } from '../../shared/logger'

export type ClientRow = typeof clients.$inferSelect
export type ManualAdjustmentRow = typeof manualAdjustments.$inferSelect

export interface ListClientsOptions {
  q?: string
  status?: 'active' | 'suspended'
  // Default: hide soft-deleted rows. Superadmin "Deleted" view passes true.
  includeDeleted?: boolean
}

/**
 * A directory row, plus the three facts the trial funnel is read from: did they
 * start a trial, did they turn up, and did they then buy something real.
 */
export type ClientListRow = ClientRow & {
  /** First trial purchase. Null = never bought a trial. */
  trialStartedAt: Date | null
  /**
   * Classes they turned up to ON the trial — not their attendance overall.
   * Someone who skipped the trial and came later on a pack has zero here, which
   * is the whole point: zero is the follow-up signal.
   */
  attended: number
  /**
   * Paid for something that isn't another trial. A second trial is not a
   * conversion, and neither is a comped grant — the question is who turned into
   * paying business. Ever, not "after the trial": someone who bought a pack
   * before trying a new class is already converted.
   */
  converted: boolean
}

/**
 * Admin client directory. Self-registered members (via the client app webhook)
 * and admin-invited members both land here. Soft-deleted clients (deletedAt
 * set) are filtered out unless includeDeleted is true.
 */
export async function listClients(
  tenantId: string,
  opts: ListClientsOptions,
): Promise<ClientListRow[]> {
  const conds: SQL[] = [eq(clients.tenantId, tenantId)]
  if (!opts.includeDeleted) conds.push(isNull(clients.deletedAt))
  if (opts.status) conds.push(eq(clients.status, opts.status))
  if (opts.q?.trim()) {
    const term = `%${opts.q.trim()}%`
    conds.push(or(ilike(clients.name, term), ilike(clients.email, term))!)
  }
  // Correlated rather than joined: each is per-client over all time, and joining
  // them would multiply a client's row by its own matches.
  // ponytail: three subqueries per row — fine at directory size (low thousands);
  // move to a grouped CTE if the list ever pages.
  const rows = await db
    .select({
      ...getTableColumns(clients),
      trialStartedAt: sql<Date | null>`(
        select min(cp.purchased_at) from ${clientPackages} cp
        where cp.client_id = "clients"."id" and cp.kind = 'trial'
      )`,
      attended: sql<number>`(
        select count(*) from ${bookings} b
        join ${clientPackages} cp on cp.id = b.client_package_id
        where b.client_id = "clients"."id"
          and b.check_in_state = 'attended'
          and cp.kind = 'trial'
      )`,
      converted: sql<boolean>`exists (
        select 1 from ${clientPackages} cp
        where cp.client_id = "clients"."id"
          and cp.kind <> 'trial'
          and cp.amount_paid_sgd > 0
      )`,
    })
    .from(clients)
    .where(and(...conds))
    .orderBy(desc(clients.joinedAt))
  return rows.map(r => ({ ...r, attended: Number(r.attended) }))
}

/**
 * Fetch by id. Soft-deleted rows are still returned (so the profile page can
 * render the "Deleted" state + Restore button); the caller decides what to do.
 */
export async function getClientById(tenantId: string, id: string): Promise<ClientRow> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, id)))
    .limit(1)
  if (!row) throw new NotFoundError('client_not_found')
  return row
}

/** Recent manual adjustments for a client, newest first (audit trail). */
export async function listRecentAdjustments(
  tenantId: string,
  clientId: string,
  limit = 50,
): Promise<ManualAdjustmentRow[]> {
  return db
    .select()
    .from(manualAdjustments)
    .where(
      and(eq(manualAdjustments.tenantId, tenantId), eq(manualAdjustments.clientId, clientId)),
    )
    .orderBy(desc(manualAdjustments.createdAt))
    .limit(limit)
}

export interface CreateClientInput {
  tenantId: string
  name: string
  email: string
  phone: string
  invitedByStaffId: string
}

function splitName(full: string): { firstName: string; lastName?: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { firstName: parts[0] ?? '' }
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') }
}

/**
 * Where the new member signs in — their own studio's app.
 *
 * It used to be the platform's single `CLIENT_ORIGIN`, which named one studio,
 * so a member added by the second studio's admin was invited to sign in at the
 * first studio's app: a hostname their Clerk account is not for and their
 * bookings are not on.
 */
function buildClientLoginUrl(tenantId: string): Promise<string> {
  return requireTenantUrl('client', tenantId).then(base => `${base}/login`)
}

/**
 * Admin-creates a member: provisions a Clerk user in the CLIENT app (so we get a
 * clerk_user_id immediately — clients.clerk_user_id is NOT NULL), inserts the
 * clients row, then emails a branded "your account is ready" invite. The invitee
 * sets their password via the client app's "forgot password" flow on first sign-in.
 *
 * The phone is stored on our row only — not sent to Clerk — so a non-E.164 number
 * never blocks account creation.
 */
export async function createClientWithInvite(input: CreateClientInput): Promise<ClientRow> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim()
  if (!name) throw new BadRequestError('name_required')
  if (!email) throw new BadRequestError('email_required')
  if (!phone) throw new BadRequestError('phone_required')

  // Resolved before Clerk is touched: an invite email nobody can act on is not
  // worth a Clerk account and a member row to go with it.
  const loginUrl = await buildClientLoginUrl(input.tenantId)

  // Reject duplicates before touching Clerk so we don't orphan a Clerk user.
  // Deliberately platform-wide, not per-tenant: `clients.email` still carries a
  // global unique index, so scoping this would only turn a clean 409 into a
  // unique violation. One person as a member of two studios is a schema change
  // that belongs with the Clerk organization work (#65).
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(sql`lower(${clients.email}) = ${email}`)
    .limit(1)
  if (existing) {
    throw new ConflictError('email_in_use', {
      message: 'A client with this email already exists.',
    })
  }

  const clerk = getClerkClientApp()
  const { firstName, lastName } = splitName(name)

  let clerkUserId: string
  try {
    const created = await clerk.users.createUser({
      emailAddress: [email],
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      skipPasswordRequirement: true,
      skipPasswordChecks: true,
    })
    clerkUserId = created.id
  } catch (err) {
    // Clerk rejects duplicate emails (and other policy violations) — surface as 409.
    const msg = err instanceof Error ? err.message : 'clerk_create_user_failed'
    throw new ConflictError('clerk_create_failed', {
      message: `Could not create the Clerk account: ${msg}`,
    })
  }

  let row: ClientRow
  try {
    const [inserted] = await db
      .insert(clients)
      .values({
        tenantId: input.tenantId,
        clerkUserId,
        email,
        name,
        phone,
        status: 'active',
      })
      .returning()
    row = inserted!
  } catch (err) {
    // Roll back the Clerk user so a failed insert doesn't leave an orphan account.
    await clerk.users.deleteUser(clerkUserId).catch(() => {})
    throw err
  }

  // Best-effort invite email (failures land in email_log, never block creation).
  await sendTemplatedEmail({
    tenantId: input.tenantId,
    slug: 'client_invite',
    recipient: { email, userId: row.id, userKind: 'client' },
    variables: {
      name,
      invitee_email: email,
      login_url: loginUrl,
    },
  })

  return row
}

export interface SoftDeleteClientInput {
  tenantId: string
  targetClientId: string
  actorStaffId: string
}

/**
 * Soft-delete a client (superadmin-only — route enforces). Sets deletedAt +
 * deletedByStaffId on the row and bans + revokes all sessions on the Clerk
 * user so they're booted immediately and cannot re-sign-in. The DB row, all
 * bookings, packages, credit ledger entries, and the clerk_user_id are
 * preserved so the action is fully reversible via restoreClient.
 *
 * Clerk side is best-effort: a transient Clerk failure must NOT roll back the
 * DB flip (admin-read-only filters and the deleted_at check on every read are
 * the load-bearing guard; banning is defense-in-depth).
 *
 * Idempotent: already-deleted target returns the existing row unchanged.
 */
export async function softDeleteClient(input: SoftDeleteClientInput): Promise<ClientRow> {
  const { tenantId, targetClientId, actorStaffId } = input

  const [target] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, targetClientId)))
    .limit(1)
  if (!target) throw new NotFoundError('client_not_found')
  if (target.deletedAt) return target

  const now = new Date()
  const [updated] = await db
    .update(clients)
    .set({
      deletedAt: now,
      deletedByStaffId: actorStaffId,
      updatedAt: now,
    })
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, targetClientId)))
    .returning()
  if (!updated) throw new ConflictError('client_delete_failed')

  // Best-effort Clerk ban + session revoke. Failures are logged, not thrown —
  // the DB flip is what locks the client out of the BE; Clerk is belt-and-braces.
  try {
    const clerk = getClerkClientApp()
    await clerk.users.banUser(target.clerkUserId).catch(err => {
      logger.warn(
        {
          clientId: targetClientId,
          err: err instanceof Error ? err.message : String(err),
        },
        'softDeleteClient: Clerk banUser failed',
      )
    })
    const sessions = await clerk.sessions.getSessionList({ userId: target.clerkUserId })
    await Promise.allSettled(sessions.data.map(s => clerk.sessions.revokeSession(s.id)))
  } catch (err) {
    logger.warn(
      {
        clientId: targetClientId,
        err: err instanceof Error ? err.message : String(err),
      },
      'softDeleteClient: Clerk client app unavailable',
    )
  }

  return updated
}

export interface RestoreClientInput {
  tenantId: string
  targetClientId: string
  actorStaffId: string
}

/**
 * Reverse a soft-delete. Clears deletedAt + deletedByStaffId and unbans the
 * Clerk user so they can sign back in. Idempotent for non-deleted targets.
 * The actorStaffId is accepted for symmetry with softDelete and audit-log
 * consistency even though it's not persisted on the row (the audit middleware
 * captures the actor).
 */
export async function restoreClient(input: RestoreClientInput): Promise<ClientRow> {
  const { tenantId, targetClientId } = input

  const [target] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, targetClientId)))
    .limit(1)
  if (!target) throw new NotFoundError('client_not_found')
  if (!target.deletedAt) return target

  const now = new Date()
  const [updated] = await db
    .update(clients)
    .set({
      deletedAt: null,
      deletedByStaffId: null,
      updatedAt: now,
    })
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, targetClientId)))
    .returning()
  if (!updated) throw new ConflictError('client_restore_failed')

  try {
    const clerk = getClerkClientApp()
    await clerk.users.unbanUser(target.clerkUserId).catch(err => {
      logger.warn(
        {
          clientId: targetClientId,
          err: err instanceof Error ? err.message : String(err),
        },
        'restoreClient: Clerk unbanUser failed',
      )
    })
  } catch (err) {
    logger.warn(
      {
        clientId: targetClientId,
        err: err instanceof Error ? err.message : String(err),
      },
      'restoreClient: Clerk client app unavailable',
    )
  }

  return updated
}
