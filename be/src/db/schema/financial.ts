import { pgTable, uuid, text, numeric, char, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const invoiceTypeEnum = pgEnum('invoice_type', ['package', 'workshop'])
export const invoiceStatusEnum = pgEnum('invoice_status', ['pending', 'paid', 'refund_requested', 'refunded'])
export const inboxStatusEnum = pgEnum('inbox_status', ['open', 'resolved', 'declined'])

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  type: invoiceTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).default('SGD'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  status: invoiceStatusEnum('status').default('pending'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const refundRequests = pgTable('refund_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  invoiceId: uuid('invoice_id').references(() => invoices.id).notNull(),
  reason: text('reason').notNull(),
  status: inboxStatusEnum('status').default('open'),
  adminNotes: text('admin_notes'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const cancellationRequests = pgTable('cancellation_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  reason: text('reason').notNull(),
  status: pgEnum('cancellation_request_status', ['open', 'resolved'])('status').default('open'),
  adminNotes: text('admin_notes'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
