import { pgTable, uuid, text, integer, boolean, timestamp, smallint, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const notificationStatusEnum = pgEnum('notification_status', [
  'queued', 'sent', 'delivered', 'bounced', 'failed',
])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id).notNull(),
  actorRole: text('actor_role').notNull(),
  impersonatedBy: uuid('impersonated_by').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const notificationTemplates = pgTable('notification_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').unique().notNull(),
  factorySubject: text('factory_subject').notNull(),
  factoryBody: text('factory_body').notNull(),
  overrideSubject: text('override_subject'),
  overrideBody: text('override_body'),
  version: integer('version').default(1),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const notificationSends = pgTable('notification_sends', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id').references(() => users.id).notNull(),
  eventType: text('event_type').notNull(),
  templateVersion: integer('template_version').notNull(),
  channel: text('channel').default('email'),
  status: notificationStatusEnum('status').default('queued'),
  resendMessageId: text('resend_message_id'),
  triggeredBy: uuid('triggered_by').references(() => users.id),
  bookingId: uuid('booking_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  enabled: boolean('enabled').default(false),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const classRatings = pgTable('class_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').unique().notNull(),
  clientId: uuid('client_id').notNull(),
  classInstanceId: uuid('class_instance_id').notNull(),
  rating: smallint('rating').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const cancellationPolicy = pgTable('cancellation_policy', {
  id: uuid('id').primaryKey().defaultRandom(),
  classWindowHours: integer('class_window_hours').notNull().default(4),
  workshopWindowDays: integer('workshop_window_days').notNull().default(7),
  privateWindowHours: integer('private_window_hours').notNull().default(24),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const marketingContent = pgTable('marketing_content', {
  id: uuid('id').primaryKey().defaultRandom(),
  heroHeading: text('hero_heading'),
  heroSubheading: text('hero_subheading'),
  pricingBlurb: text('pricing_blurb'),
  footerText: text('footer_text'),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})
