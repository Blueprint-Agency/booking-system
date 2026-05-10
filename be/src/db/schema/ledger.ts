import { pgTable, uuid, text, timestamp, integer, numeric, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { clients, staffUsers } from './identity'
import { clientPackages } from './packages'
import { bookings } from './bookings'
import { auditActorTypeEnum, stripePaymentKindEnum, stripePaymentStatusEnum } from '../enums'

export const manualAdjustments = pgTable(
  'manual_adjustments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    clientPackageId: uuid('client_package_id')
      .notNull()
      .references(() => clientPackages.id, { onDelete: 'restrict' }),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    actedByStaffId: uuid('acted_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    clientCreatedIdx: index('manual_adjustments_client_created_idx').on(table.clientId, table.createdAt),
    packageIdx: index('manual_adjustments_package_idx').on(table.clientPackageId),
  }),
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorStaffId: uuid('actor_staff_id').references(() => staffUsers.id, { onDelete: 'restrict' }),
    actorType: auditActorTypeEnum('actor_type').notNull(),
    action: text('action').notNull(),
    targetTable: text('target_table').notNull(),
    targetId: uuid('target_id').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    targetIdx: index('audit_log_target_idx').on(table.targetTable, table.targetId, table.createdAt),
    actorIdx: index('audit_log_actor_idx').on(table.actorStaffId, table.createdAt),
    actionIdx: index('audit_log_action_idx').on(table.action, table.createdAt),
  }),
)

export const stripePayments = pgTable(
  'stripe_payments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    paymentIntentId: text('payment_intent_id').notNull().unique(),
    amountSgd: numeric('amount_sgd', { precision: 10, scale: 2 }).notNull(),
    kind: stripePaymentKindEnum('kind').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    clientPackageId: uuid('client_package_id').references(() => clientPackages.id, {
      onDelete: 'restrict',
    }),
    status: stripePaymentStatusEnum('status').notNull().default('pending'),
    receiptUrl: text('receipt_url'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    paymentIntentUnique: uniqueIndex('stripe_payments_intent_unique').on(table.paymentIntentId),
    clientCreatedIdx: index('stripe_payments_client_created_idx').on(table.clientId, table.createdAt),
  }),
)
