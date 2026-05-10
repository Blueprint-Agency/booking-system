import { pgTable, uuid, text, integer, numeric, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const packageTypeEnum = pgEnum('package_type', ['bundle', 'unlimited', 'private_vip'])
export const clientPackageStatusEnum = pgEnum('client_package_status', ['active', 'queued', 'expired', 'cancelled'])

export const packages = pgTable('packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: packageTypeEnum('type').notNull(),
  creditCount: integer('credit_count'),
  sessionCount: integer('session_count'),
  validityDays: integer('validity_days').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const clientPackages = pgTable('client_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  packageId: uuid('package_id').references(() => packages.id).notNull(),
  status: clientPackageStatusEnum('status').default('active'),
  creditBalance: integer('credit_balance'),
  sessionBalance: integer('session_balance'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  issuedBy: uuid('issued_by').references(() => users.id),
  issueReason: text('issue_reason'),
  invoiceId: uuid('invoice_id'),
  queuedAfter: uuid('queued_after'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
