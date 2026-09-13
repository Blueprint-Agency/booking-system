import { pgTable, text, timestamp, boolean, integer, uuid, index } from 'drizzle-orm/pg-core'
import { tenants } from './tenancy'

/**
 * The three Better Auth user pools: `client` (members), `staff` (studio
 * portals) and `platform` (the super portal). Each pool owns its own four or
 * five tables, so a member cannot sign into a portal and a studio superadmin's
 * credentials do not exist in the pool the super portal reads — the property
 * the three Clerk applications gave us, kept by table rather than by vendor.
 * The instances that read these tables are in `services/auth/better-auth.ts`.
 *
 * **No `tenant_id` on any of them, deliberately.** These are platform rows,
 * like `tenants`: a staff member of two studios is ONE user row with a
 * `staff_users` row at each studio (`staff_users.auth_user_id`), and a member
 * of two studios is one user with two `clients` rows. A `tenant_id` column
 * would force that person into two accounts with two passwords.
 *
 * It matters for Row-Level Security too, and in a way that is easy to undo by
 * accident. `ensureTenantIsolation` (`db/roles.ts`) fences EVERY table that has
 * a column called `tenant_id`, found by name. So the Tenant a session was
 * signed in on — its claim, written at sign-in from #113 on — lives in
 * `claimed_tenant_id` and must never be renamed to `tenant_id`. Named that, the
 * sweep would put a policy on the sessions table, and then:
 *
 *   - every session outside a Tenant context would be invisible — the super
 *     portal's, and any session looked up before `resolveTenant` has run; and
 *   - "sign out everywhere", which deletes a user's sessions across every studio
 *     they work at, would only reach the studio whose context happened to be
 *     open, and quietly leave the others signed in.
 *
 * The platform pool has no claim column at all: the super portal has no Tenant.
 *
 * Column shapes are Better Auth's own (`getAuthTables` in `@better-auth/core`),
 * with camelCase keys because the Drizzle adapter looks fields up by key.
 */

const userColumns = () => ({
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
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

/** The Tenant this session was signed in on. See the note at the top of the file. */
const claimedTenantId = () =>
  uuid('claimed_tenant_id').references(() => tenants.id, { onDelete: 'cascade' })

/* ── client: members, signed in by emailed code ────────────────────────── */

export const clientAuthUsers = pgTable('client_auth_users', userColumns())

const clientUserId = () =>
  text('user_id')
    .notNull()
    .references(() => clientAuthUsers.id, { onDelete: 'cascade' })

export const clientAuthSessions = pgTable(
  'client_auth_sessions',
  { ...sessionColumns(clientUserId), claimedTenantId: claimedTenantId() },
  table => ({ userIdx: index('client_auth_sessions_user_idx').on(table.userId) }),
)

export const clientAuthAccounts = pgTable('client_auth_accounts', accountColumns(clientUserId), table => ({
  userIdx: index('client_auth_accounts_user_idx').on(table.userId),
}))

export const clientAuthVerifications = pgTable('client_auth_verifications', verificationColumns(), table => ({
  identifierIdx: index('client_auth_verifications_identifier_idx').on(table.identifier),
}))

/* ── staff: studio portals, password + second factor ───────────────────── */

export const staffAuthUsers = pgTable('staff_auth_users', {
  ...userColumns(),
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
})

const staffUserId = () =>
  text('user_id')
    .notNull()
    .references(() => staffAuthUsers.id, { onDelete: 'cascade' })

export const staffAuthSessions = pgTable(
  'staff_auth_sessions',
  { ...sessionColumns(staffUserId), claimedTenantId: claimedTenantId() },
  table => ({ userIdx: index('staff_auth_sessions_user_idx').on(table.userId) }),
)

export const staffAuthAccounts = pgTable('staff_auth_accounts', accountColumns(staffUserId), table => ({
  userIdx: index('staff_auth_accounts_user_idx').on(table.userId),
}))

export const staffAuthVerifications = pgTable('staff_auth_verifications', verificationColumns(), table => ({
  identifierIdx: index('staff_auth_verifications_identifier_idx').on(table.identifier),
}))

export const staffAuthTwoFactors = pgTable('staff_auth_two_factors', twoFactorColumns(staffUserId), table => ({
  userIdx: index('staff_auth_two_factors_user_idx').on(table.userId),
  secretIdx: index('staff_auth_two_factors_secret_idx').on(table.secret),
}))

/* ── platform: the super portal, password + second factor, no Tenant ───── */

export const platformAuthUsers = pgTable('platform_auth_users', {
  ...userColumns(),
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
