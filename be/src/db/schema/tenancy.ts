import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantStatusEnum } from '../enums'

/**
 * A Tenant is one studio business on the platform. Creating one is a row insert
 * — never infra — and its subdomains (`{slug}.reservetoday.app`,
 * `{slug}.portal.reservetoday.app`) resolve the moment the row exists.
 *
 * Yoga Sadhana is tenant #1 (`slug = 'yogasadhana'`); every pre-existing row in
 * the database was backfilled to it.
 */
/**
 * Yoga Sadhana's tenant id. Fixed rather than generated so every environment —
 * local, staging, production, the test harness — agrees on which row is tenant
 * #1; migration 0027 backfilled every pre-existing row to it.
 */
export const TENANT_ONE_ID = '10000000-0000-0000-0000-000000000001'
export const TENANT_ONE_SLUG = 'yogasadhana'

/**
 * The throwaway second tenant, seeded outside production. A single-tenant
 * environment cannot reveal a cross-tenant leak — every missing
 * `WHERE tenant_id = ?` looks correct when there is only one tenant's data to
 * return — so local, staging and the test harness all run two.
 */
export const SECOND_TENANT_ID = '10000000-0000-0000-0000-000000000002'
export const SECOND_TENANT_SLUG = 'acme'

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
    // One Clerk Organization per tenant in each of the two Clerk applications
    // (client + portal). Null until the org is provisioned.
    clerkClientOrgId: text('clerk_client_org_id').unique(),
    clerkPortalOrgId: text('clerk_portal_org_id').unique(),
    status: tenantStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    statusIdx: index('tenants_status_idx').on(table.status),
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
 * The `tenant_id` column every other table carries.
 *
 * This is the *contract* step of expand-migrate-contract (#63). `NOT NULL` with
 * **no default**: every insert now has to name its tenant, and one that forgets
 * fails loudly instead of quietly filing somebody else's row under Yoga Sadhana.
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

export type TenantRow = typeof tenants.$inferSelect
export type TenantSettingsRow = typeof tenantSettings.$inferSelect
