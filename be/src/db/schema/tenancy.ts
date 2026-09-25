import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  date,
  bigint,
  integer,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantStatusEnum } from '../enums'

/**
 * A Tenant is one studio business on the platform. Creating one is a row insert
 * — never infra — and its subdomains (`{slug}.reservetoday.app`,
 * `{slug}.portal.reservetoday.app`) resolve the moment the row exists.
 *
 * No studio is named anywhere in this file, or in any other file the server
 * runs. A studio's identity is *its data*: it arrives by being created or
 * restored through the super portal, and the backend reads it out of the
 * `tenants` row like every other studio's. The two ids below are the only fixed
 * points, and they name positions rather than businesses.
 */
/**
 * The first tenant's id — a *position*, not a studio.
 *
 * Fixed rather than generated because migration 0027 backfilled every row that
 * predated tenancy to this id: at that moment the database held exactly one
 * studio's data, and this is the row it became. Whichever studio that was on a
 * given deployment is that deployment's business and appears nowhere in the
 * code.
 *
 * Used only by the seed fixtures now. The server no longer reads it at all —
 * the last runtime use was `tenantMatches` treating a null `tenant_id` as this
 * tenant, which stopped being a sensible reading when the column became
 * `NOT NULL`.
 */
export const TENANT_ONE_ID = '10000000-0000-0000-0000-000000000001'

/**
 * The throwaway second tenant, seeded outside production. A single-tenant
 * environment cannot reveal a cross-tenant leak — every missing
 * `WHERE tenant_id = ?` looks correct when there is only one tenant's data to
 * return — so local, staging and the test harness all run two.
 */
export const SECOND_TENANT_ID = '10000000-0000-0000-0000-000000000002'

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // The leftmost DNS label. Validated + reserved-word checked at creation —
    // see services/tenants/slug.ts.
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    // IANA zone. Drives every "daily at 01:00" job — "Asia/Singapore" is only
    // right for tenant #1.
    timezone: text('timezone').notNull().default('Asia/Singapore'),
    status: tenantStatusEnum('status').notNull().default('active'),
    // The studio's Term — the stretch of time it has paid for (see
    // services/tenants/term.ts). Calendar dates on the studio's own clock
    // (`timezone`), never instants. The start defaults to the day it was
    // provisioned; the default here is only a backstop for an insert that names
    // none, because `CURRENT_DATE` is the database's day, not the studio's.
    termStartDate: date('term_start_date', { mode: 'string' })
      .notNull()
      .default(sql`CURRENT_DATE`),
    // The first day the studio is no longer paid for: start + the duration the
    // operator picked. Null is "no end set" — an open-ended Term, which every
    // studio that predates Terms has until the operator gives it one. From this
    // date on the studio counts as suspended wherever its status is read.
    termEndDate: date('term_end_date', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    statusIdx: index('tenants_status_idx').on(table.status),
  }),
)

/**
 * A Slug a Tenant used to answer on, kept while its old addresses redirect.
 *
 * Written by a rename (`services/tenants/rename.ts`). For `redirect_until` the
 * former Slug is a redirect target for the frontends' proxies and nothing more —
 * the API never resolves it as a Tenant — and no other Tenant may take it, so
 * nobody can stand up on a studio's old address while its bookmarks, emails
 * and posters still point there. The nightly release deletes it afterwards.
 *
 * Platform data like `tenants`, not Tenant data: the Tenant is named by
 * `renamed_tenant_id`, never `tenant_id`, so neither the Row-Level Security
 * sweep (`ensureTenantIsolation`) nor the studio archive picks it up — both
 * find their tables by that column name.
 */
export const formerSlugs = pgTable(
  'former_slugs',
  {
    slug: text('slug').primaryKey(),
    renamedTenantId: uuid('renamed_tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // What the Tenant was renamed *to* at the time — a record of the rename.
    // Redirects read the Tenant's current slug instead, so a second rename
    // does not strand the first one's old address.
    newSlug: text('new_slug').notNull(),
    renamedAt: timestamp('renamed_at', { withTimezone: true }).notNull().defaultNow(),
    redirectUntil: timestamp('redirect_until', { withTimezone: true }).notNull(),
    // The platform administrator's email. Not a foreign key: the platform pool's
    // accounts come and go, and the record must outlive the account.
    renamedBy: text('renamed_by').notNull(),
  },
  table => ({
    tenantIdx: index('former_slugs_renamed_tenant_id_idx').on(table.renamedTenantId),
  }),
)

/**
 * Everything a tenant can re-skin: branding, copy, the from-identity on its
 * mail, its theme tokens and its waiver text. Split from `tenants` because the
 * identity row sits on the request path (slug resolution) while this is the
 * bulky, rarely-read half.
 */
export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Branding
  displayName: text('display_name'),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  ogImageUrl: text('og_image_url'),

  // Copy — `tagline` is the one string every surface shows; anything else a
  // tenant overrides (hero, footer, empty states) lives in the jsonb blob so a
  // new overridable string doesn't need a migration.
  tagline: text('tagline'),
  copy: jsonb('copy').notNull().default(sql`'{}'::jsonb`),

  // Theme tokens (colours, radius, font family) consumed by both frontends.
  theme: jsonb('theme').notNull().default(sql`'{}'::jsonb`),

  // Mail-from identity. Null falls back to the platform default in lib/mailer.ts.
  mailFromName: text('mail_from_name'),
  mailFromEmail: text('mail_from_email'),
  mailReplyTo: text('mail_reply_to'),

  // Liability waiver shown at sign-up. The `waiver` table remains the live
  // source of truth for tenant #1; this column is where per-tenant waiver text
  // lands as tenants are provisioned.
  waiverText: text('waiver_text'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A studio's own payment-provider account (#100).
 *
 * There is no platform account in the middle — Stripe Connect is not available
 * to this platform — so a studio hands over the credentials to its own account
 * and every call on its behalf is made against that account directly. A Tenant
 * with no row here takes no online payments (#293): there is no platform
 * account behind it any more.
 *
 * Both secrets are sealed (`lib/secret-box.ts`); `accountId` is not, because it
 * names the account rather than opening it, and naming it is the whole of what
 * the super portal is allowed to show back.
 *
 * Written only inside `withTenant` (the Row-Level Security policy in migration
 * 0048 sees to that) and read by the accessor through the owner-owned
 * `tenant_payment_credentials_for()` function, because the webhook that needs it has no
 * context to open yet.
 */
export const tenantPaymentCredentials = pgTable('tenant_payment_credentials', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('stripe'),
  accountId: text('account_id').notNull(),
  secretKeySealed: text('secret_key_sealed').notNull(),
  webhookSecretSealed: text('webhook_secret_sealed').notNull(),
  /**
   * The webhook endpoint the platform created on the studio's account (#294),
   * so it can be deleted when the key is replaced or removed. Not a secret: it
   * names the endpoint, and its signing secret is the sealed column above.
   * Null on rows saved before #294, whose endpoint was made by hand.
   */
  webhookEndpointId: text('webhook_endpoint_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * The `tenant_id` column every other table carries.
 *
 * This is the *contract* step of expand-migrate-contract (#63). `NOT NULL` with
 * **no default**: every insert now has to name its tenant, and one that forgets
 * fails loudly instead of quietly filing somebody else's row under tenant #1.
 * The scaffolding default that made the migrate batches safe is gone with it.
 *
 * The column is on every table — including pure join tables — because Row-Level
 * Security needs something local to key a policy on; a join table that inferred
 * its tenant through a foreign key could only be protected by a subquery, and a
 * policy that has to join is a policy that gets dropped for performance.
 */
export const tenantIdColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' })

/**
 * One restore of a studio archive into a Tenant, as a job the server runs.
 *
 * The super portal's import used to be a single request that held the archive,
 * wrote every row and answered with the summary — so a reload, a closed tab or
 * a proxy timeout lost the only record of how it went, and there was nothing to
 * show a progress bar from. This row is that record: created before the upload,
 * advanced by the upload and then by the import itself, and read back by the
 * page whenever it loads.
 *
 * **Not studio data.** It carries a `tenant_id` so Row-Level Security fences it
 * like every other Tenant-scoped row (the sweep in `db/roles.ts` finds it by
 * that column), but it is about the *platform's* handling of the studio, not
 * part of the studio. So `tenantTableOrder` leaves it out: it is not exported in
 * an archive, it does not make a studio count as non-empty to the import's own
 * emptiness check, and it goes with the studio on delete by `ON DELETE CASCADE`
 * rather than as one of the studio's rows.
 *
 * `updated_at` is the heartbeat. The process running the job touches it every
 * few seconds; a job still `uploading` or `processing` whose heartbeat has
 * stopped belongs to a request that was dropped or a process that died, and is
 * marked failed when next read (`services/tenants/import-jobs.ts`).
 */
export const tenantImports = pgTable(
  'tenant_imports',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** `uploading` → `processing` → `succeeded` | `failed`. */
    status: text('status').notNull().default('uploading'),
    /** What the job is doing right now, finer than `status` — see `ImportPhase`. */
    phase: text('phase').notNull().default('uploading'),
    fileName: text('file_name').notNull(),
    /** The archive's size as the browser reported it, and how much has arrived. */
    uploadBytes: bigint('upload_bytes', { mode: 'number' }).notNull(),
    receivedBytes: bigint('received_bytes', { mode: 'number' }).notNull().default(0),
    /** Steps done of the steps there are, once the archive is being written. */
    processed: integer('processed').notNull().default(0),
    total: integer('total'),
    /** The route's old response body, once it succeeded. */
    summary: jsonb('summary'),
    /** A machine code and a sentence the operator can act on, once it failed. */
    errorCode: text('error_code'),
    error: text('error'),
    /** The platform administrator's email — not a foreign key, like `renamed_by`. */
    startedBy: text('started_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Set when the operator closed the finished job's notice on the studio list. */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  table => ({
    /**
     * One running import per studio. Two at once would race to the same
     * emptiness check, and the second one's rows would be refused only after its
     * whole archive had been uploaded — or, worse, interleave with the first.
     */
    oneRunning: uniqueIndex('tenant_imports_one_running')
      .on(table.tenantId)
      .where(sql`status IN ('uploading', 'processing')`),
    latest: index('tenant_imports_tenant_created_idx').on(table.tenantId, table.createdAt),
    statusValid: check(
      'tenant_imports_status_valid',
      sql`${table.status} IN ('uploading', 'processing', 'succeeded', 'failed')`,
    ),
  }),
)

export type TenantImportRow = typeof tenantImports.$inferSelect

export type TenantRow = typeof tenants.$inferSelect
export type TenantSettingsRow = typeof tenantSettings.$inferSelect
export type FormerSlugRow = typeof formerSlugs.$inferSelect
