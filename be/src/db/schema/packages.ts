import { pgTable, uuid, text, timestamp, integer, numeric, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { clients } from './identity'
import {
  classPackageKindEnum,
  ptSessionTypeEnum,
  packageStatusEnum,
  clientPackageKindEnum,
} from '../enums'

export const classPackages = pgTable(
  'class_packages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    kind: classPackageKindEnum('kind').notNull(),
    credits: integer('credits'),
    validityDays: integer('validity_days'),
    durationDays: integer('duration_days'),
    priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
    status: packageStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  table => ({
    statusKindIdx: index('class_packages_status_kind_idx').on(table.status, table.kind),
    kindFields: check(
      'class_packages_kind_fields',
      sql`(${table.kind} = 'credit_bundle' AND ${table.credits} IS NOT NULL AND ${table.validityDays} IS NOT NULL)
       OR (${table.kind} = 'unlimited' AND ${table.durationDays} IS NOT NULL)`,
    ),
  }),
)

export const ptPackages = pgTable('pt_packages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  sessionType: ptSessionTypeEnum('session_type').notNull(),
  numSessions: integer('num_sessions').notNull(),
  priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
  status: packageStatusEnum('status').notNull().default('active'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})

export const clientPackages = pgTable(
  'client_packages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    kind: clientPackageKindEnum('kind').notNull(),
    sourceClassPackageId: uuid('source_class_package_id').references(() => classPackages.id, {
      onDelete: 'restrict',
    }),
    sourcePtPackageId: uuid('source_pt_package_id').references(() => ptPackages.id, {
      onDelete: 'restrict',
    }),
    creditsOrSessionsRemaining: integer('credits_or_sessions_remaining'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
    amountPaidSgd: numeric('amount_paid_sgd', { precision: 10, scale: 2 }).notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
  },
  table => ({
    clientKindIdx: index('client_packages_client_kind_idx').on(table.clientId, table.kind),
    clientExpiryIdx: index('client_packages_client_expiry_idx').on(table.clientId, table.expiresAt),
    stripeIntentUnique: uniqueIndex('client_packages_stripe_intent_unique').on(table.stripePaymentIntentId),
    nonNegBalance: check(
      'client_packages_non_negative_balance',
      sql`${table.creditsOrSessionsRemaining} IS NULL OR ${table.creditsOrSessionsRemaining} >= 0`,
    ),
  }),
)
