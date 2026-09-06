import { pgTable, uuid, text, timestamp, integer, numeric, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { clientPackages } from './packages'
import { bookings } from './bookings'
import {
  auditActorTypeEnum,
  purchaseKindEnum,
  purchaseStatusEnum,
  stripePaymentKindEnum,
  stripePaymentStatusEnum,
} from '../enums'

/**
 * A Purchase owns the money; a payment is evidence of part of it.
 *
 * Until this table existed, one purchase was one payment intent, and that
 * assumption was load-bearing across plans, workshops, Merch and Cross-Location
 * Add-Ons. It cannot survive either half of #89: a member paying with two cards
 * needs many payments per purchase, and a Refund on a connected account becomes
 * several provider calls. So the sale becomes a row of its own, holding what was
 * bought, what it costs and how much has been paid, and the payment rows point
 * at it.
 *
 * The rule this makes safe is one comparison, in `services/billing/balance.ts`:
 * **nothing is granted until the Balance reaches zero.** A sale paid in full at
 * the first attempt — today's only shape — is simply a Purchase that closes
 * immediately, which is why nothing a member or an admin can see changes.
 */
export const purchases = pgTable(
  'purchases',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    kind: purchaseKindEnum('kind').notNull(),
    /**
     * Frozen at creation and never recomputed. The member is told what they owe
     * before their first payment, and a price that could move between the first
     * card and the second would be a debt that grows while it is being settled
     * (story 12).
     */
    totalSgd: numeric('total_sgd', { precision: 10, scale: 2 }).notNull(),
    /**
     * Derived, not authoritative: recomputed from the payment rows every time
     * one lands. Stored so the account page and the finance figures can read a
     * Balance without summing the ledger, never so that it can disagree with it.
     */
    amountPaidSgd: numeric('amount_paid_sgd', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),
    status: purchaseStatusEnum('status').notNull().default('open'),
    /**
     * What the webhook grants from — the same key/value bag the checkout session
     * carries, held here so a second payment against the same Purchase grants
     * exactly what the first one would have. Session metadata is capped and
     * editable by anyone holding the session; this is the copy that is neither.
     */
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    /**
     * The one live checkout session, if a payment is in flight. Singular on
     * purpose: two open sessions against one Purchase is two members' worth of
     * money against one Balance, and there is no way to tell afterwards which
     * one the member meant.
     */
    checkoutSessionId: text('checkout_session_id'),
    /**
     * When the first payment landed that did **not** clear the Balance (#93).
     *
     * Not derivable from the other columns: `amount_paid_sgd` says what is held
     * right now, so a Purchase part-paid at noon and finished at one o'clock is
     * indistinguishable afterwards from one paid in full at the first attempt.
     * The portal has to tell those apart — a member who part-paid is somebody
     * the front desk will meet — and the studio's "money held against nothing
     * granted" figure has to say since when.
     */
    partPaidAt: timestamp('part_paid_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    clientCreatedIdx: index('purchases_client_created_idx').on(
      table.tenantId,
      table.clientId,
      table.createdAt,
    ),
    // Also the whole of the #93 "money held against nothing granted" read,
    // which is `sum(amount_paid_sgd) where status = 'open'`. A member's own
    // unfinished purchases come off `clientCreatedIdx` below, which already
    // leads with the two columns that query filters on and ends with the one it
    // orders by — so part payment needed no index of its own.
    statusIdx: index('purchases_status_idx').on(table.tenantId, table.status),
    // Scoped to the Tenant for the same reason `stripe_payments_intent_unique`
    // is (migration 0040): a studio's archive restored beside its source keeps
    // the provider's identifiers in both.
    checkoutSessionUnique: uniqueIndex('purchases_checkout_session_unique').on(
      table.tenantId,
      table.checkoutSessionId,
    ),
  }),
)

export const manualAdjustments = pgTable(
  'manual_adjustments',
  {
    tenantId: tenantIdColumn(),
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
    clientCreatedIdx: index('manual_adjustments_client_created_idx').on(table.tenantId, table.clientId, table.createdAt),
    packageIdx: index('manual_adjustments_package_idx').on(table.tenantId, table.clientPackageId),
  }),
)

export const auditLog = pgTable(
  'audit_log',
  {
    tenantId: tenantIdColumn(),
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
    targetIdx: index('audit_log_target_idx').on(table.tenantId, table.targetTable, table.targetId, table.createdAt),
    actorIdx: index('audit_log_actor_idx').on(table.tenantId, table.actorStaffId, table.createdAt),
    actionIdx: index('audit_log_action_idx').on(table.tenantId, table.action, table.createdAt),
  }),
)

export const stripePayments = pgTable(
  'stripe_payments',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Unique per Tenant, not platform-wide — see `paymentIntentUnique` below.
    paymentIntentId: text('payment_intent_id').notNull(),
    /**
     * The sale this payment is evidence of part of. **NOT NULL** since #92: it
     * is now the only route from money to what the money bought, because the
     * plan and the booking point at the Purchase and no longer at an intent.
     *
     * The webhook opens one rather than writing null if a session ever arrives
     * without one in its metadata — see `purchaseForPayment`.
     */
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'restrict' }),
    amountSgd: numeric('amount_sgd', { precision: 10, scale: 2 }).notNull(),
    kind: stripePaymentKindEnum('kind').notNull(),
    // Null once the member is permanently deleted (#144): the payment is the
    // studio's to keep for its accounts, the member's identity is not.
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
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
    // Scoped to the Tenant. Every lookup in `billing/webhook-handler.ts` already
    // pairs the intent id with a tenant id — the webhook resolves the Tenant
    // from the client in the intent's metadata before it asks about the payment
    // — so nothing depended on the constraint being platform-wide, and a
    // platform-wide one stops a studio's archive being restored beside it.
    paymentIntentUnique: uniqueIndex('stripe_payments_intent_unique').on(
      table.tenantId,
      table.paymentIntentId,
    ),
    clientCreatedIdx: index('stripe_payments_client_created_idx').on(table.tenantId, table.clientId, table.createdAt),
    // Every recompute of a Balance reads a Purchase's payments by this.
    purchaseIdx: index('stripe_payments_purchase_idx').on(table.tenantId, table.purchaseId),
  }),
)
