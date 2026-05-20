import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { manualAdjustments } from '../../db/schema/ledger'
import { getClerkClientApp } from '../../lib/clerk'
import { env } from '../../env'
import { sendTemplatedEmail } from '../notifications/send'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export type ClientRow = typeof clients.$inferSelect
export type ManualAdjustmentRow = typeof manualAdjustments.$inferSelect

export interface ListClientsOptions {
  q?: string
  status?: 'active' | 'suspended'
}

/**
 * Admin client directory. Self-registered members (via the client app webhook)
 * and admin-invited members both land here.
 */
export async function listClients(opts: ListClientsOptions): Promise<ClientRow[]> {
  const conds = []
  if (opts.status) conds.push(eq(clients.status, opts.status))
  if (opts.q?.trim()) {
    const term = `%${opts.q.trim()}%`
    conds.push(or(ilike(clients.name, term), ilike(clients.email, term)))
  }
  return db
    .select()
    .from(clients)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(clients.joinedAt))
}

export async function getClientById(id: string): Promise<ClientRow> {
  const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)
  if (!row) throw new NotFoundError('client_not_found')
  return row
}

/** Recent manual adjustments for a client, newest first (audit trail). */
export async function listRecentAdjustments(
  clientId: string,
  limit = 50,
): Promise<ManualAdjustmentRow[]> {
  return db
    .select()
    .from(manualAdjustments)
    .where(eq(manualAdjustments.clientId, clientId))
    .orderBy(desc(manualAdjustments.createdAt))
    .limit(limit)
}

export interface CreateClientInput {
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

function buildClientLoginUrl(): string {
  const base = env.CLIENT_ORIGIN?.replace(/\/+$/, '')
  return base ? `${base}/login` : ''
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

  // Reject duplicates before touching Clerk so we don't orphan a Clerk user.
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
    slug: 'client_invite',
    recipient: { email, userId: row.id, userKind: 'client' },
    variables: {
      name,
      invitee_email: email,
      login_url: buildClientLoginUrl(),
    },
  })

  return row
}
