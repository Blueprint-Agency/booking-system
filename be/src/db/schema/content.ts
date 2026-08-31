import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { emailRecipientKindEnum, emailLogStatusEnum } from '../enums'

/**
 * The copy of one email, for one tenant.
 *
 * `slug` names the *event* — `welcome`, `leave_approved` — so every tenant has
 * a row for every slug and only the wording differs. It was platform-unique,
 * which would have put one studio's words, links and sign-off in another
 * studio's outbox; only the pair (tenant, slug) is unique.
 *
 * `tenant_id` is `NOT NULL` here ahead of the contract step (#63) for the same
 * reason it is on `promo_codes`: Postgres treats NULLs as distinct in a unique
 * index, so a nullable column would let two rows both be `welcome` while the
 * (tenant, slug) lookup that renders them finds neither.
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    tenantId: tenantIdColumn().notNull(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    tenantSlugUnique: uniqueIndex('email_templates_tenant_slug_unique').on(
      table.tenantId,
      table.slug,
    ),
  }),
)

export const emailLog = pgTable(
  'email_log',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    templateSlug: text('template_slug').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    recipientUserId: uuid('recipient_user_id'),
    recipientUserKind: emailRecipientKindEnum('recipient_user_kind').notNull(),
    subjectRendered: text('subject_rendered').notNull(),
    bodyRendered: text('body_rendered').notNull(),
    status: emailLogStatusEnum('status').notNull().default('queued'),
    smtpMessageId: text('smtp_message_id'),
    smtpResponse: text('smtp_response'),
    error: text('error'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  table => ({
    recipientQueuedIdx: index('email_log_recipient_queued_idx').on(table.recipientUserId, table.queuedAt),
    statusIdx: index('email_log_status_idx').on(table.status),
    templateQueuedIdx: index('email_log_template_queued_idx').on(table.templateSlug, table.queuedAt),
  }),
)

/**
 * The liability text a member signs — one row **per tenant**, not one row.
 *
 * It carried a `CHECK (id = '<fixed uuid>')`, which is the right constraint for
 * one studio and the wrong one for two: no second tenant could own a row, so
 * every second tenant would have been shown Yoga Sadhana's waiver and its
 * members would have put their name to a document about another business. The
 * check is gone, the id is generated, and the unique index on `tenant_id` is
 * what holds the table to one row each.
 */
export const waiver = pgTable(
  'waiver',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bodyHtml: text('body_html').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    oneRowPerTenant: uniqueIndex('waiver_tenant_uniq').on(table.tenantId),
  }),
)

export const waiverSignatures = pgTable(
  'waiver_signatures',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    clientUnique: uniqueIndex('waiver_signatures_client_unique').on(table.clientId),
  }),
)

/**
 * The public site's copy — hero, pricing blurb, testimonials, footer. Same
 * story as `waiver` above: a platform singleton means a second tenant's home
 * page advertises the first tenant's studio, so the check is gone and the row
 * is one per tenant.
 */
export const marketingContent = pgTable(
  'marketing_content',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    heroHeading: text('hero_heading').notNull(),
    heroSubheading: text('hero_subheading').notNull(),
    pricingBlurb: text('pricing_blurb'),
    testimonials: jsonb('testimonials'),
    footerText: text('footer_text'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    oneRowPerTenant: uniqueIndex('marketing_content_tenant_uniq').on(table.tenantId),
  }),
)
