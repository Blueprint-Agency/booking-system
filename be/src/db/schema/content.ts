import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { clients, staffUsers } from './identity'
import { emailRecipientKindEnum, emailStatusEnum } from '../enums'

export const emailTemplates = pgTable('email_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: text('slug').notNull().unique(),
  subject: text('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
    onDelete: 'restrict',
  }),
})

export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    templateSlug: text('template_slug').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    recipientUserId: uuid('recipient_user_id'),
    recipientUserKind: emailRecipientKindEnum('recipient_user_kind').notNull(),
    subjectRendered: text('subject_rendered').notNull(),
    bodyRendered: text('body_rendered').notNull(),
    status: emailStatusEnum('status').notNull().default('queued'),
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

const WAIVER_SINGLETON_ID = '00000000-0000-0000-0000-000000000003'

export const waiver = pgTable(
  'waiver',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`'${sql.raw(WAIVER_SINGLETON_ID)}'::uuid`),
    bodyHtml: text('body_html').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    singleton: check('waiver_singleton', sql`${table.id} = '${sql.raw(WAIVER_SINGLETON_ID)}'::uuid`),
  }),
)

export const waiverSignatures = pgTable(
  'waiver_signatures',
  {
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

const MARKETING_SINGLETON_ID = '00000000-0000-0000-0000-000000000004'

export const marketingContent = pgTable(
  'marketing_content',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`'${sql.raw(MARKETING_SINGLETON_ID)}'::uuid`),
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
    singleton: check('marketing_content_singleton', sql`${table.id} = '${sql.raw(MARKETING_SINGLETON_ID)}'::uuid`),
  }),
)
