import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../../db/schema'

/**
 * The user table of each pool something provisions into: the password pools
 * from a seed or an invitation, the client pool when a member registers or an
 * admin adds one.
 */
const USERS = {
  client: schema.clientAuthUsers,
  staff: schema.staffAuthUsers,
  platform: schema.platformAuthUsers,
} as const

type UserWriter = Pick<PostgresJsDatabase<typeof schema>, 'insert' | 'select'>

/**
 * Make sure a Better Auth user exists for this address, and return its id.
 *
 * **Passwordless, like the Clerk bootstrap it sits beside.** The row is a user
 * with no credential account at all; the person sets their first password
 * through the reset flow (`/request-password-reset`), which creates the
 * credential when there is none. So no password lives in `.env`, CI logs or a
 * deployer's disk. The address is marked verified because whoever wrote the
 * seed vouched for it, and a reset mailed to it is the proof.
 *
 * Idempotent: an existing user — with whatever password they have since chosen
 * — is found by address and left untouched, so re-running a seed on every
 * deploy locks nobody out.
 */
export async function ensureAuthUser(
  db: UserWriter,
  pool: keyof typeof USERS,
  input: { email: string; name: string },
): Promise<string> {
  const users = USERS[pool]
  const email = input.email.trim().toLowerCase()

  await db
    .insert(users)
    .values({ id: randomUUID(), email, name: input.name, emailVerified: true })
    .onConflictDoNothing({ target: users.email })

  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!row) throw new Error(`ensureAuthUser: no ${pool} user for ${email} after insert`)
  return row.id
}

/** The shortest and longest password the staff pool accepts — Better Auth's defaults. */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

type Reader = Pick<PostgresJsDatabase<typeof schema>, 'select'>
type Deleter = Pick<PostgresJsDatabase<typeof schema>, 'delete'>

/** Does this staff auth user have a password yet? */
export async function hasStaffPassword(db: Reader, userId: string): Promise<boolean> {
  const accounts = schema.staffAuthAccounts
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .limit(1)
  return Boolean(row)
}

/**
 * Give a staff auth user their first password, hashed the way Better Auth hashes
 * one, on a credential account of the shape its own sign-up writes. Only for a
 * user who has none: replacing a password is the reset flow's job.
 */
export async function setFirstStaffPassword(db: UserWriter, userId: string, password: string): Promise<void> {
  await db.insert(schema.staffAuthAccounts).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(password),
  })
}

export async function renameStaffUser(
  db: Pick<PostgresJsDatabase<typeof schema>, 'update'>,
  userId: string,
  name: string,
): Promise<void> {
  await db
    .update(schema.staffAuthUsers)
    .set({ name, updatedAt: new Date() })
    .where(eq(schema.staffAuthUsers.id, userId))
}

/**
 * End a staff user's sessions **at one studio**.
 *
 * Not the admin plugin's revoke-all, which is keyed on the user alone: one staff
 * auth user signs into every studio they work at, a session per hostname, and
 * archiving them at studio A must not sign them out of studio B, where they are
 * still staff. The session's Tenant claim is what tells the two apart.
 */
export async function endStaffSessionsAt(db: Deleter, tenantId: string, userId: string): Promise<number> {
  const sessions = schema.staffAuthSessions
  const ended = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.claimedTenantId, tenantId)))
    .returning({ id: sessions.id })
  return ended.length
}

/**
 * End a member's sessions **at one studio** — for the reason `endStaffSessionsAt`
 * gives: one member auth user signs into every studio they have joined, and
 * blocking them at studio A is not studio A's to do at studio B.
 */
export async function endClientSessionsAt(db: Deleter, tenantId: string, userId: string): Promise<number> {
  const sessions = schema.clientAuthSessions
  const ended = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.claimedTenantId, tenantId)))
    .returning({ id: sessions.id })
  return ended.length
}

/** A session as the portal shows it on a person's detail view (#119). */
export type SessionAtStudio = {
  id: string
  signedInAt: Date
  /**
   * When the session was last refreshed. Better Auth moves `updated_at` when it
   * extends a session, at most once per `updateAge` (a day, by default), so this
   * is "active on that day", not the minute of their last request.
   */
  lastSeenAt: Date
  expiresAt: Date
  ip: string | null
  userAgent: string | null
  /** Opened by a superadmin impersonating the member; always false for staff. */
  impersonated: boolean
}

/**
 * The live sessions a user holds **at one studio**, newest first — the same
 * slice `endStaffSessionsAt` / `endClientSessionsAt` end, so what the admin sees
 * is exactly what "sign out everywhere" removes.
 */
export async function listSessionsAt(
  db: Reader,
  pool: 'client' | 'staff',
  tenantId: string,
  userId: string,
): Promise<SessionAtStudio[]> {
  const sessions = pool === 'client' ? schema.clientAuthSessions : schema.staffAuthSessions
  const rows = await db
    .select({
      id: sessions.id,
      signedInAt: sessions.createdAt,
      lastSeenAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
      ip: sessions.ipAddress,
      userAgent: sessions.userAgent,
      impersonatedBy: pool === 'client' ? schema.clientAuthSessions.impersonatedBy : sql<null>`null`,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.claimedTenantId, tenantId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.updatedAt))
  return rows.map(({ impersonatedBy, ...row }) => ({ ...row, impersonated: Boolean(impersonatedBy) }))
}

/**
 * Remove a staff auth user nobody has used. With no password there was never a
 * session, so nothing is lost. One with a password is left alone: it may be the
 * same person's account at another studio, which this studio cannot see.
 */
export async function removeUnusedStaffUser(db: Reader & Deleter, userId: string): Promise<void> {
  if (await hasStaffPassword(db, userId)) return
  await db.delete(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.id, userId))
}
