import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, integer, uuid, index, unique } from 'drizzle-orm/pg-core'
import { authEventKindEnum, authPoolEnum } from '../enums'
import { tenants } from './tenancy'

/**
 * The three Better Auth user pools: `client` (members), `staff` (studio
 * portals) and `platform` (the super portal). Each pool owns its own four or
 * five tables, so a member cannot sign into a portal and a studio admin's
 * credentials do not exist in the pool the super portal reads — separation
 * kept by table rather than by vendor account.
 * The instances that read these tables are in `services/auth/better-auth.ts`.
 *
 * **A studio's logins are that studio's own.** Every `client` and `staff`
 * table carries a `tenant_id`, and an address is unique per studio, not
 * platform-wide: the same email at two studios is two accounts, with two
 * passwords, two second factors and two sets of sessions, and nothing done at
 * one studio — a reset, a sign-up, a block, a deletion — reaches the other.
 * `ensureTenantIsolation` (`db/roles.ts`) fences every table with a `tenant_id`
 * column, found by name, so these get the same Row-Level Security policy as
 * every other studio row: Better Auth's own queries, which run inside the
 * Tenant context `resolveTenant` opened, see only this studio's logins, and a
 * query with no context sees none.
 *
 * `tenant_id` defaults to the transaction's Tenant (`app.tenant_id`), because
 * Better Auth writes sessions, credentials, verifications and second factors
 * itself and cannot be told to name one. With no context the default is null
 * and the insert fails on `NOT NULL` — the same loud failure a domain table's
 * missing `tenant_id` gives.
 *
 * `claimed_tenant_id` on the sessions predates this: the Tenant a session was
 * signed in on, checked by the middlewares (`session-claim.ts`). It now always
 * equals `tenant_id`, and stays as the belt to RLS's braces.
 *
 * The `platform` pool has none of this: the super portal has no Tenant, and an
 * operator is one account, platform-wide.
 *
 * Column shapes are Better Auth's own (`getAuthTables` in `@better-auth/core`),
 * with camelCase keys because the Drizzle adapter looks fields up by key.
 */

const userColumns = () => ({
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

const sessionColumns = <U>(userId: () => U) => ({
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: userId(),
})

const accountColumns = <U>(userId: () => U) => ({
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: userId(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

const verificationColumns = () => ({
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

const twoFactorColumns = <U>(userId: () => U) => ({
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: userId(),
  verified: boolean('verified').default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
})

/** The studio a login row belongs to — the transaction's Tenant. See the note at the top of the file. */
const loginTenantId = () =>
  uuid('tenant_id')
    .notNull()
    .default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`)
    .references(() => tenants.id, { onDelete: 'restrict' })

/** The Tenant this session was signed in on. See the note at the top of the file. */
const claimedTenantId = () =>
  uuid('claimed_tenant_id').references(() => tenants.id, { onDelete: 'cascade' })

/* ── client: members, signed in by email and password ─────────────────── */

export const clientAuthUsers = pgTable(
  'client_auth_users',
  { ...userColumns(), tenantId: loginTenantId() },
  table => ({ tenantEmailUnique: unique('client_auth_users_tenant_email_unique').on(table.tenantId, table.email) }),
)

const clientUserId = () =>
  text('user_id')
    .notNull()
    .references(() => clientAuthUsers.id, { onDelete: 'cascade' })

export const clientAuthSessions = pgTable(
  'client_auth_sessions',
  {
    ...sessionColumns(clientUserId),
    tenantId: loginTenantId(),
    claimedTenantId: claimedTenantId(),
    /**
     * Set on a session a studio admin opened as this member (#118): the
     * admin's `staff` pool auth user id. The admin plugin's field name, and
     * no foreign key — it names a user in another pool's table.
     */
    impersonatedBy: text('impersonated_by'),
  },
  table => ({
    userIdx: index('client_auth_sessions_user_idx').on(table.userId),
    tenantIdx: index('client_auth_sessions_tenant_idx').on(table.tenantId),
    claimedTenantIdFkIdx: index('client_auth_sessions_claimed_tenant_id_fk_idx').on(table.claimedTenantId),
  }),
)

export const clientAuthAccounts = pgTable(
  'client_auth_accounts',
  { ...accountColumns(clientUserId), tenantId: loginTenantId() },
  table => ({
    userIdx: index('client_auth_accounts_user_idx').on(table.userId),
    tenantIdx: index('client_auth_accounts_tenant_idx').on(table.tenantId),
  }),
)

export const clientAuthVerifications = pgTable(
  'client_auth_verifications',
  { ...verificationColumns(), tenantId: loginTenantId() },
  table => ({
    identifierIdx: index('client_auth_verifications_identifier_idx').on(table.identifier),
    tenantIdx: index('client_auth_verifications_tenant_idx').on(table.tenantId),
  }),
)

/* ── staff: studio portals, password + second factor ───────────────────── */

export const staffAuthUsers = pgTable(
  'staff_auth_users',
  {
    ...userColumns(),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    tenantId: loginTenantId(),
  },
  table => ({ tenantEmailUnique: unique('staff_auth_users_tenant_email_unique').on(table.tenantId, table.email) }),
)

const staffUserId = () =>
  text('user_id')
    .notNull()
    .references(() => staffAuthUsers.id, { onDelete: 'cascade' })

export const staffAuthSessions = pgTable(
  'staff_auth_sessions',
  { ...sessionColumns(staffUserId), tenantId: loginTenantId(), claimedTenantId: claimedTenantId() },
  table => ({
    userIdx: index('staff_auth_sessions_user_idx').on(table.userId),
    tenantIdx: index('staff_auth_sessions_tenant_idx').on(table.tenantId),
    claimedTenantIdFkIdx: index('staff_auth_sessions_claimed_tenant_id_fk_idx').on(table.claimedTenantId),
  }),
)

export const staffAuthAccounts = pgTable(
  'staff_auth_accounts',
  { ...accountColumns(staffUserId), tenantId: loginTenantId() },
  table => ({
    userIdx: index('staff_auth_accounts_user_idx').on(table.userId),
    tenantIdx: index('staff_auth_accounts_tenant_idx').on(table.tenantId),
  }),
)

export const staffAuthVerifications = pgTable(
  'staff_auth_verifications',
  { ...verificationColumns(), tenantId: loginTenantId() },
  table => ({
    identifierIdx: index('staff_auth_verifications_identifier_idx').on(table.identifier),
    tenantIdx: index('staff_auth_verifications_tenant_idx').on(table.tenantId),
  }),
)

export const staffAuthTwoFactors = pgTable(
  'staff_auth_two_factors',
  { ...twoFactorColumns(staffUserId), tenantId: loginTenantId() },
  table => ({
    userIdx: index('staff_auth_two_factors_user_idx').on(table.userId),
    secretIdx: index('staff_auth_two_factors_secret_idx').on(table.secret),
    tenantIdx: index('staff_auth_two_factors_tenant_idx').on(table.tenantId),
  }),
)

/* ── platform: the super portal, password + second factor, no Tenant ───── */

export const platformAuthUsers = pgTable('platform_auth_users', {
  ...userColumns(),
  // One operator, one account, platform-wide.
  email: text('email').notNull().unique(),
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
})

const platformUserId = () =>
  text('user_id')
    .notNull()
    .references(() => platformAuthUsers.id, { onDelete: 'cascade' })

export const platformAuthSessions = pgTable(
  'platform_auth_sessions',
  sessionColumns(platformUserId),
  table => ({ userIdx: index('platform_auth_sessions_user_idx').on(table.userId) }),
)

export const platformAuthAccounts = pgTable('platform_auth_accounts', accountColumns(platformUserId), table => ({
  userIdx: index('platform_auth_accounts_user_idx').on(table.userId),
}))

export const platformAuthVerifications = pgTable(
  'platform_auth_verifications',
  verificationColumns(),
  table => ({ identifierIdx: index('platform_auth_verifications_identifier_idx').on(table.identifier) }),
)

export const platformAuthTwoFactors = pgTable(
  'platform_auth_two_factors',
  twoFactorColumns(platformUserId),
  table => ({
    userIdx: index('platform_auth_two_factors_user_idx').on(table.userId),
    secretIdx: index('platform_auth_two_factors_secret_idx').on(table.secret),
  }),
)

/* ── auth_events: who signed in as whom, when (#114) ───────────────────── */

/**
 * The sign-in audit log, written by `services/auth/auth-events.ts` from every
 * pool's hooks. An event happens at one studio, and carries its `tenant_id`.
 *
 * **The one table whose `tenant_id` is nullable, on purpose.** A studio pool's
 * event belongs to the studio it happened at and is fenced like any other
 * studio row. A platform-pool event happened at no studio, so its Tenant is
 * null — and `ensureTenantIsolation` gives this table the platform-row policy
 * (`PLATFORM_ROWS` in `db/roles.ts`): a Tenant context sees that Tenant's rows,
 * and no context — the super portal's — sees only the null ones.
 *
 * Holds no email and never a password or a code. The actor is the auth user id
 * in `pool`'s table, when one is known: a failed sign-in for an address that
 * has no account has no actor. No foreign key to the pool tables — there are
 * three of them, and the record should outlive the account. The subject is
 * the user acted on, when it is not the actor: the member an impersonation
 * signed in as. An impersonation row is filed under `staff` (#118): its actor is
 * the studio admin's staff auth user, its subject the member's client auth user.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    pool: authPoolEnum('pool').notNull(),
    kind: authEventKindEnum('kind').notNull(),
    actorUserId: text('actor_user_id'),
    subjectUserId: text('subject_user_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    tenantCreatedIdx: index('auth_events_tenant_created_idx').on(table.tenantId, table.createdAt),
    actorCreatedIdx: index('auth_events_actor_created_idx').on(table.actorUserId, table.createdAt),
  }),
)
