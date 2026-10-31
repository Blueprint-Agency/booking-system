import { pgTable, uuid, text, timestamp, jsonb, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { staffUsers } from './identity'
import { emailRecipientKindEnum, emailLogStatusEnum } from '../enums'

/**
 * The copy of one email, for one tenant.
 *
 * `slug` names the *event* — `welcome`, `leave_approved` — so every tenant has
 * a row for every slug and only the wording differs. It was platform-unique,
 * which would have put one studio's words, links and sign-off in another
 * studio's outbox; only the pair (tenant, slug) is unique.
 *
 * `tenant_id` is `NOT NULL` here ahead of the contract step for the same
 * reason it is on `promo_codes`: Postgres treats NULLs as distinct in a unique
 * index, so a nullable column would let two rows both be `welcome` while the
 * (tenant, slug) lookup that renders them finds neither.
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    tenantId: tenantIdColumn(),
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
    updatedByStaffIdFkIdx: index('email_templates_updated_by_staff_id_fk_idx').on(table.updatedByStaffId),
    tenantSlugUnique: uniqueIndex('email_templates_tenant_slug_unique').on(
      table.tenantId,
      table.slug,
    ),
  }),
)

/**
 * A studio's switch for one of its emails (`services/notifications/switches.ts`).
 *
 * No row is on: a studio that has never touched a switch sends everything, as
 * every studio did before the switches existed. A row is written the first time
 * an admin changes that email, and kept after it is switched back on, so the
 * audit rows about it name one target. A locked email's row is never read.
 */
export const emailSwitches = pgTable(
  'email_switches',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    enabled: boolean('enabled').notNull(),
  },
  table => ({
    tenantSlugUnique: uniqueIndex('email_switches_tenant_slug_unique').on(table.tenantId, table.slug),
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
    /** When Resend's webhook last moved `status` past `sent` — delivered, bounced and so on. */
    outcomeAt: timestamp('outcome_at', { withTimezone: true }),
  },
  table => ({
    recipientQueuedIdx: index('email_log_recipient_queued_idx').on(table.tenantId, table.recipientUserId, table.queuedAt),
    statusIdx: index('email_log_status_idx').on(table.tenantId, table.status),
    templateQueuedIdx: index('email_log_template_queued_idx').on(table.tenantId, table.templateSlug, table.queuedAt),
  }),
)

/**
 * The public site's copy — hero, pricing blurb, testimonials, footer. One row
 * **per tenant**, not one row: it carried a `CHECK (id = '<fixed uuid>')`, the
 * right constraint for one studio and the wrong one for two, because a platform
 * singleton means a second tenant's home page advertises the first tenant's
 * studio. The check is gone and the id is generated.
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
    updatedByStaffIdFkIdx: index('marketing_content_updated_by_staff_id_fk_idx').on(table.updatedByStaffId),
    oneRowPerTenant: uniqueIndex('marketing_content_tenant_uniq').on(table.tenantId),
  }),
)
