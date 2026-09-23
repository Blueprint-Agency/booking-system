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

type NewUser = { email: string; name: string }

/**
 * Make sure a Better Auth user exists for this address, and return its id.
 *
 * **Per studio in the `staff` and `client` pools** (#231): the same address at
 * two studios is two users, so the studio is named, and the user is found or
 * made at that studio only. Named rather than read from the Tenant context,
 * because the seeds, the e2e studio helper and the test harness write on the
 * owner connection, where there is none. The `platform` pool has no studio.
 *
 * **Passwordless.** The row is a user
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
export async function ensureAuthUser(db: UserWriter, pool: 'platform', input: NewUser): Promise<string>
export async function ensureAuthUser(
  db: UserWriter,
  pool: 'client' | 'staff',
  input: NewUser & { tenantId: string },
): Promise<string>
export async function ensureAuthUser(
  db: UserWriter,
  pool: keyof typeof USERS,
  input: NewUser & { tenantId?: string },
): Promise<string> {
  const email = input.email.trim().toLowerCase()
  const values = { id: randomUUID(), email, name: input.name, emailVerified: true }

  let row: { id: string } | undefined
  if (pool === 'platform') {
    const users = USERS.platform
    await db.insert(users).values(values).onConflictDoNothing({ target: users.email })
    ;[row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  } else {
    const users = USERS[pool]
    // Invariant: the overloads above require a Tenant for the studio pools.
    if (!input.tenantId) throw new Error(`ensureAuthUser: a ${pool} user belongs to a studio, and none was named`)
    const tenantId = input.tenantId
    await db
      .insert(users)
      .values({ ...values, tenantId })
      .onConflictDoNothing({ target: [users.tenantId, users.email] })
    ;[row] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
      .limit(1)
  }
  // Invariant: the insert above either wrote this address or found it already there.
  if (!row) throw new Error(`ensureAuthUser: no ${pool} user for ${email} after insert`)
  return row.id
}

/** The shortest and longest password every pool accepts — Better Auth's defaults. */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

type Reader = Pick<PostgresJsDatabase<typeof schema>, 'select'>
type Deleter = Pick<PostgresJsDatabase<typeof schema>, 'delete'>

/** Does this staff auth user have a password yet? */
export async function hasStaffPassword(db: Reader, userId: string): Promise<boolean> {
  return hasPassword(db, 'staff', userId)
}

/** Does this auth user, in one of the password pools, have a password yet? */
export async function hasPassword(db: Reader, pool: 'staff' | 'platform', userId: string): Promise<boolean> {
  const accounts = pool === 'staff' ? schema.staffAuthAccounts : schema.platformAuthAccounts
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
    tenantId: loginTenant(schema.staffAuthUsers, userId),
  })
}

/**
 * The studio a login belongs to, for a credential written beside it — read off
 * the user rather than the Tenant context, so the e2e studio helper, writing on
 * the owner connection, writes the same row a request does.
 */
const loginTenant = (users: typeof schema.staffAuthUsers | typeof schema.clientAuthUsers, userId: string) =>
  sql<string>`(select ${users.tenantId} from ${users} where ${users.id} = ${userId})`

/**
 * Give a member auth user the password they chose at registration (#173),
 * replacing any they had: registration has just proved the email with a code,
 * which is as much as a reset link proves. The user is this studio's login, so
 * the password is this studio's only (#231).
 */
export async function setMemberPassword(
  db: UserWriter & Deleter,
  userId: string,
  password: string,
): Promise<void> {
  const accounts = schema.clientAuthAccounts
  await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
  await db.insert(accounts).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(password),
    tenantId: loginTenant(schema.clientAuthUsers, userId),
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
 * A login is one studio's own (#231), so its sessions are all at that studio;
 * the claim in the query says so out loud rather than leaning on that alone.
 */
export async function endStaffSessionsAt(db: Deleter, tenantId: string, userId: string): Promise<number> {
  const sessions = schema.staffAuthSessions
  const ended = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.claimedTenantId, tenantId)))
    .returning({ id: sessions.id })
  return ended.length
}

/** End a member's sessions **at one studio**, as `endStaffSessionsAt` does for staff. */
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
  /** Opened by a studio admin impersonating the member; always false for staff. */
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
 * Remove the staff login of someone whose pending invitation was revoked. It
 * is this studio's login and nobody else's (#231), so it simply goes, and any
 * credential and session with it by cascade.
 */
export async function deleteStaffLogin(db: Deleter, userId: string): Promise<void> {
  await db.delete(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.id, userId))
}
