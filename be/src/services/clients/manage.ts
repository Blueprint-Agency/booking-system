import { and, asc, desc, eq, getTableColumns, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { clientPackages } from '../../db/schema/packages'
import { bookings } from '../../db/schema/bookings'
import { manualAdjustments } from '../../db/schema/ledger'
import { waiverSignatures } from '../../db/schema/content'
import { endClientSessionsAt, ensureAuthUser } from '../auth/auth-users'
import { recordStaffAct } from '../auth/staff-acts'
import { requireTenantUrl } from '../tenants/urls'
import { sendTemplatedEmail } from '../notifications/send'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export type ClientRow = typeof clients.$inferSelect
export type ManualAdjustmentRow = typeof manualAdjustments.$inferSelect

export interface ListClientsOptions {
  q?: string
  status?: 'active' | 'suspended'
  // Default: hide soft-deleted rows. The admin "Deleted" view passes true.
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
  // Three subqueries per row over the whole studio. The Customers page no longer
  // reads this — it pages through `listClientsPage` below; this unpaged read is
  // kept for the callers that want every member.
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
          and not cp.complimentary
      )`,
    })
    .from(clients)
    .where(and(...conds))
    .orderBy(desc(clients.joinedAt))
  return rows.map(r => ({ ...r, attended: Number(r.attended) }))
}

export type ClientDirectoryFilter = 'active' | 'trials' | 'blocked'
export type ClientDirectorySort = 'joined' | 'name'

export interface ListClientsPageOptions extends ListClientsOptions {
  /**
   * The Customers page's filter pills. `active` hides blocked members, `blocked`
   * shows only them, `trials` only members who ever bought a trial. Absent means
   * "all" — which still honours `includeDeleted`.
   */
  filter?: ClientDirectoryFilter
  sort?: ClientDirectorySort
  /** 1-based. */
  page: number
  pageSize: number
}

/**
 * The Trial Funnel over every member the filter matches — not just the page on
 * screen, which is what the old client-side count silently became the moment
 * the list paged.
 */
export interface TrialFunnel {
  trials: number
  attended: number
  converted: number
}

export interface ClientDirectoryPage {
  rows: ClientListRow[]
  /** Members matching the filter and search, across every page. */
  total: number
  /** Only when `filter` is `trials`; null otherwise. */
  funnel: TrialFunnel | null
}

// The three trial-funnel facts, as SQL over a client id expression. One
// definition, read by both the page rows and the funnel totals, so the tiles
// above the list cannot count differently from the rows under them.
//
// Each names the Tenant as well as the member, so Postgres can reach for the
// `(tenant_id, client_id, …)` indexes — a funnel over a studio with years of
// imported bookings must not scan `bookings` once per trial.
const hasTrial = (clientId: SQL) => sql`exists (
  select 1 from ${clientPackages} cp
  where cp.client_id = ${clientId} and cp.kind = 'trial'
)`
const trialAttendedCount = (tenantId: string, clientId: SQL) => sql`(
  select count(*) from ${clientPackages} cp
  join ${bookings} b
    on b.tenant_id = ${tenantId}::uuid and b.client_id = cp.client_id and b.client_package_id = cp.id
  where cp.client_id = ${clientId}
    and cp.kind = 'trial'
    and b.check_in_state = 'attended'
)`
const hasConverted = (tenantId: string, clientId: SQL) => sql`exists (
  select 1 from ${clientPackages} cp
  where cp.tenant_id = ${tenantId}::uuid
    and cp.client_id = ${clientId}
    and cp.kind <> 'trial'
    and cp.amount_paid_sgd > 0
    and not cp.complimentary
)`

/**
 * One page of the admin Customers directory, with the total the pager needs.
 *
 * Search, filter and sort all run in Postgres, so they apply across every
 * member rather than to the page already fetched. The trial facts are read for
 * the page's rows only — one grouped read for up to `pageSize` ids — instead of
 * three correlated subqueries per member of the whole studio.
 */
export async function listClientsPage(
  tenantId: string,
  opts: ListClientsPageOptions,
): Promise<ClientDirectoryPage> {
  const conds: SQL[] = [eq(clients.tenantId, tenantId)]
  if (opts.filter === 'blocked') conds.push(isNotNull(clients.deletedAt))
  else if (opts.filter === 'active' || !opts.includeDeleted) conds.push(isNull(clients.deletedAt))
  if (opts.filter === 'trials') conds.push(hasTrial(sql`${clients.id}`))
  if (opts.status) conds.push(eq(clients.status, opts.status))
  const term = opts.q?.trim()
  if (term) {
    const like = `%${term}%`
    conds.push(or(ilike(clients.name, like), ilike(clients.email, like), ilike(clients.phone, like))!)
  }
  const where = and(...conds)

  const order =
    opts.sort === 'name'
      ? [asc(sql`lower(${clients.name})`), asc(clients.id)]
      : [desc(clients.joinedAt), asc(clients.id)]

  const [countRow, members] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(clients).where(where),
    db
      .select()
      .from(clients)
      .where(where)
      .orderBy(...order)
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
  ])

  const facts = new Map<string, { trialStartedAt: Date | null; attended: number; converted: boolean }>()
  if (members.length > 0) {
    const ids = members.map(m => m.id)
    const rows = await db
      .select({
        id: clients.id,
        trialStartedAt: sql<Date | null>`(
          select min(cp.purchased_at) from ${clientPackages} cp
          where cp.client_id = ${clients.id} and cp.kind = 'trial'
        )`.mapWith(v => (v === null ? null : new Date(v as string))),
        attended: trialAttendedCount(tenantId, sql`${clients.id}`).mapWith(Number),
        converted: hasConverted(tenantId, sql`${clients.id}`).mapWith(Boolean),
      })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), inArray(clients.id, ids)))
    for (const r of rows) facts.set(r.id, r)
  }

  let funnel: TrialFunnel | null = null
  if (opts.filter === 'trials') {
    const [f] = await db
      .select({
        trials: sql<number>`count(*)::int`,
        attended: sql<number>`count(*) filter (where ${trialAttendedCount(tenantId, sql`${clients.id}`)} > 0)::int`,
        converted: sql<number>`count(*) filter (where ${hasConverted(tenantId, sql`${clients.id}`)})::int`,
      })
      .from(clients)
      .where(where)
    funnel = { trials: f?.trials ?? 0, attended: f?.attended ?? 0, converted: f?.converted ?? 0 }
  }

  return {
    rows: members.map(m => ({
      ...m,
      trialStartedAt: facts.get(m.id)?.trialStartedAt ?? null,
      attended: facts.get(m.id)?.attended ?? 0,
      converted: facts.get(m.id)?.converted ?? false,
    })),
    total: countRow[0]?.n ?? 0,
    funnel,
  }
}

/**
 * The contact facts the customer detail page shows beside the directory row:
 * the optional profile fields and whether the waiver is signed. Read with the
 * row itself, so a member of another studio is a 404 here exactly as it is in
 * `getClientById`.
 */
export interface ClientContact {
  client: ClientRow
  waiverSignedAt: Date | null
  referredBy: { id: string; name: string } | null
}

export async function getClientContact(tenantId: string, id: string): Promise<ClientContact> {
  const client = await getClientById(tenantId, id)
  const [waiver, referrer] = await Promise.all([
    db
      .select({ signedAt: waiverSignatures.signedAt })
      .from(waiverSignatures)
      .where(and(eq(waiverSignatures.tenantId, tenantId), eq(waiverSignatures.clientId, id)))
      .limit(1),
    client.referredByClientId
      ? db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(and(eq(clients.tenantId, tenantId), eq(clients.id, client.referredByClientId)))
          .limit(1)
      : Promise.resolve([]),
  ])
  return {
    client,
    waiverSignedAt: waiver[0]?.signedAt ?? null,
    referredBy: referrer[0] ?? null,
  }
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

/**
 * Where the new member signs in — their own studio's app.
 *
 * It used to be the platform's single `CLIENT_ORIGIN`, which named one studio,
 * so a member added by the second studio's admin was invited to sign in at the
 * first studio's app: a hostname their bookings are not on.
 */
function buildClientLoginUrl(tenantId: string): Promise<string> {
  return requireTenantUrl('client', tenantId).then(base => `${base}/login`)
}

/**
 * Admin-creates a member: the `client` pool's auth user and the clients row in
 * one transaction, then a branded "your account is ready" invite. The account
 * has no password: the member's first sign-in mails them a link to set one (#173).
 *
 * The auth user is found rather than created when the address already has one —
 * the same person, a member at another studio — and this studio gets its own row.
 */
export async function createClientWithInvite(input: CreateClientInput): Promise<ClientRow> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim()
  if (!name) throw new BadRequestError('name_required')
  if (!email) throw new BadRequestError('email_required')
  if (!phone) throw new BadRequestError('phone_required')

  // Resolved before anything is written: an invite email nobody can act on is
  // not worth an account and a member row to go with it.
  const loginUrl = await buildClientLoginUrl(input.tenantId)

  // Per studio, like the unique index (`clients_tenant_email_unique`): one
  // person may be a member of two studios, with a record at each.
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, input.tenantId), sql`lower(${clients.email}) = ${email}`))
    .limit(1)
  if (existing) {
    throw new ConflictError('email_in_use', {
      message: 'A client with this email already exists.',
    })
  }

  const row = await db.transaction(async tx => {
    const authUserId = await ensureAuthUser(tx, 'client', { email, name })
    const [inserted] = await tx
      .insert(clients)
      .values({
        tenantId: input.tenantId,
        authUserId,
        email,
        name,
        phone,
        status: 'active',
      })
      .returning()
    return inserted!
  })

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
  /** The acting staff member's request, for the `auth_events` row (#119). */
  from?: Headers
}

/**
 * Soft-delete a client (admin-only — route enforces). Sets deletedAt +
 * deletedByStaffId on the row and ends the member's sessions at this studio, so
 * they're booted immediately and cannot sign in here again. The DB row, all
 * bookings, packages, credit ledger entries, and the auth user are preserved so
 * the action is fully reversible via restoreClient.
 *
 * At this studio only, not through Better Auth's admin ban, which is keyed on the
 * auth user: the same person may be a member at another studio, and blocking
 * them here is not this studio's to do there.
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

  // Their sessions here end now rather than at the next request's
  // `requireActiveClient`. The flip above stays the load-bearing guard: it is
  // what refuses the next sign-in (the client pool's session hook reads it).
  if (target.authUserId) await endClientSessionsAt(db, tenantId, target.authUserId)
  await recordStaffAct({ tenantId, actorStaffId, kind: 'user_blocked', subjectUserId: target.authUserId, from: input.from })

  return updated
}

export interface RestoreClientInput {
  tenantId: string
  targetClientId: string
  actorStaffId: string
  /** The acting staff member's request, for the `auth_events` row (#119). */
  from?: Headers
}

/**
 * Reverse a soft-delete. Clears deletedAt + deletedByStaffId, which is what
 * lets the member sign back in. Idempotent for non-deleted targets.
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

  // Nothing to undo on the auth side: the sign-in refusal reads the flag cleared above.
  await recordStaffAct({
    tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'user_unblocked',
    subjectUserId: target.authUserId,
    from: input.from,
  })
  return updated
}
