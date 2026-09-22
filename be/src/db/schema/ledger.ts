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
 * needs many payments per purchase, and a Refund of a sale paid across two
 * cards becomes several provider calls. So the sale becomes a row of its own, holding what was
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
    // Nullable for one reason only: a member may be permanently deleted (#144),
    // and every row FK-referencing a Purchase is `restrict` and kept as the
    // studio's accounts — so the Purchase cannot go with them and is emptied of
    // them instead. `client_packages.client_id` is nullable for the same reason.
    // Nothing that creates a Purchase may leave it null.
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
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
    clientIdFkIdx: index('purchases_client_id_fk_idx').on(table.clientId),
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
    actedByStaffIdFkIdx: index('manual_adjustments_acted_by_staff_id_fk_idx').on(table.actedByStaffId),
    clientIdFkIdx: index('manual_adjustments_client_id_fk_idx').on(table.clientId),
    clientPackageIdFkIdx: index('manual_adjustments_client_package_id_fk_idx').on(table.clientPackageId),
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
    actorStaffIdFkIdx: index('audit_log_actor_staff_id_fk_idx').on(table.actorStaffId),
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
    /**
     * The provider account this payment was taken on — **null is the platform's
     * own**, not "unknown" (#97).
     *
     * Written once, at capture, and never updated. A studio that moves onto its
     * own account (#100) leaves its history behind on the platform's, because
     * no provider will hand a payment intent from one account to another; so a
     * Refund years later has to be issued on the account the money actually
     * came in on, and the studio's *current* credentials are the wrong answer
     * to that question. This column is the right one.
     */
    providerAccountId: text('provider_account_id'),
    receiptUrl: text('receipt_url'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    bookingIdFkIdx: index('stripe_payments_booking_id_fk_idx').on(table.bookingId),
    clientIdFkIdx: index('stripe_payments_client_id_fk_idx').on(table.clientId),
    clientPackageIdFkIdx: index('stripe_payments_client_package_id_fk_idx').on(table.clientPackageId),
    purchaseIdFkIdx: index('stripe_payments_purchase_id_fk_idx').on(table.purchaseId),
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

/**
 * Who a member is **at the payment provider** — the id their saved cards hang
 * off (#185).
 *
 * A card cannot be saved against an email. It is saved against a Customer, so
 * until a member is one, every checkout is a card number typed in full, and the
 * next one is the same number typed again.
 *
 * ## One row per member *per account*, which is the whole reason this is a table
 *
 * A Customer id belongs to the account it was created on and means nothing
 * anywhere else. Since #100 a studio can supply its own credentials, so the
 * account a member's cards live on is not a property of the member — it is a
 * property of where the studio sells *today*. A studio that moves accounts
 * leaves its members' old Customers behind, exactly as it leaves its payments
 * behind (`stripe_payments.provider_account_id`), and the first checkout on the
 * new account makes each member a Customer there. Both rows then coexist, one
 * per account, and each is only ever read together with its account.
 *
 * That is also what "cards saved at one studio never appear at another" reduces
 * to here: the lookup is `(tenant_id, client_id, account)`, with Row-Level
 * Security as the backstop under it. Two studios on the *same* platform account
 * still get a Customer each, because the Tenant is in the key.
 *
 * `provider_account_id` follows the convention `stripe_payments` set: **NULL is
 * the platform's own account**, not "unknown".
 *
 * Nothing here is a secret and nothing here is money. It is a pointer, and if
 * the whole table were lost the worst that happens is every member is asked to
 * type a card number once more.
 */
export const paymentCustomers = pgTable(
  'payment_customers',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /**
     * The member. **NOT NULL**, and deleted rather than emptied when they are
     * (#144): unlike a payment, this row is not part of the studio's accounts —
     * it is the member's identity at a third party, which is the one thing
     * permanent deletion is for. `member-tables.ts` says so in the one list
     * both deletion and export read.
     */
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /** The account this Customer exists on; NULL is the platform's own. */
    providerAccountId: text('provider_account_id'),
    /** The Customer id itself — `cus_…`. Never reused across accounts. */
    customerId: text('customer_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    clientIdFkIdx: index('payment_customers_client_id_fk_idx').on(table.clientId),
    /**
     * One Customer per member per account — the constraint the whole design
     * rests on, because a second row would silently split one member's cards
     * into two piles and show them half of their own wallet.
     *
     * `NULLS NOT DISTINCT` is load-bearing, and is written out in the migration
     * because Drizzle cannot express it: Postgres treats NULLs as distinct in a
     * unique index by default, and the platform account — the common case, and
     * the only case until a studio supplies credentials of its own — *is* the
     * NULL. Without it the constraint would hold for exactly the studios that
     * least need it.
     */
    memberAccountUnique: uniqueIndex('payment_customers_member_account_unique').on(
      table.tenantId,
      table.clientId,
      table.providerAccountId,
    ),
  }),
)
