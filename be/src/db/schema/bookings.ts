import { pgTable, uuid, text, timestamp, integer, numeric, boolean, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { classes, workshops, workshopTiers, ptSessions } from './schedule'
import { clientPackages, promoCodes, promotions } from './packages'
import {
  bookingKindEnum,
  bookingStateEnum,
  refundOutcomeEnum,
  checkinStateEnum,
  cancellationKindEnum,
  cancellationSourceEnum,
  checkinMethodEnum,
} from '../enums'

export const bookings = pgTable(
  'bookings',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    kind: bookingKindEnum('kind').notNull(),
    classId: uuid('class_id').references(() => classes.id, { onDelete: 'restrict' }),
    workshopId: uuid('workshop_id').references(() => workshops.id, { onDelete: 'restrict' }),
    workshopTierId: uuid('workshop_tier_id').references(() => workshopTiers.id, { onDelete: 'restrict' }),
    ptSessionId: uuid('pt_session_id').references(() => ptSessions.id, { onDelete: 'restrict' }),
    clientPackageId: uuid('client_package_id').references(() => clientPackages.id, {
      onDelete: 'restrict',
    }),
    // Frozen at purchase when a workshop promotion resolved. Null for class/PT bookings
    // (where the promotion already froze onto the client_packages row used to book).
    appliedPromotionId: uuid('applied_promotion_id').references(() => promotions.id, {
      onDelete: 'restrict',
    }),
    // The Promo Code the member typed, frozen beside the Promotion (§11). The
    // money taken off is frozen on the Redemption row; only the identifier lands
    // here, because staff may edit the label later.
    appliedPromoCodeId: uuid('applied_promo_code_id').references(() => promoCodes.id, {
      onDelete: 'restrict',
    }),
    state: bookingStateEnum('state').notNull().default('confirmed'),
    // Workshop money, frozen at purchase (§15). Required for kind = 'workshop',
    // null for every other kind — class and PT bookings are paid for by a package
    // and their money stays on the client_packages row. A free workshop records a
    // list price with zero paid, same as a comp grant. Money off is derived.
    listPriceSgd: numeric('list_price_sgd', { precision: 10, scale: 2 }),
    amountPaidSgd: numeric('amount_paid_sgd', { precision: 10, scale: 2 }),
    creditsOrSessionsUsed: integer('credits_or_sessions_used'),
    refundOutcome: refundOutcomeEnum('refund_outcome').notNull().default('n_a'),
    checkInState: checkinStateEnum('check_in_state').notNull().default('pending'),
    qrToken: text('qr_token').notNull(),
    code: text('code').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    bookedAt: timestamp('booked_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  table => ({
    clientBookedIdx: index('bookings_client_booked_idx').on(table.tenantId, table.clientId, table.bookedAt),
    classStateIdx: index('bookings_class_state_idx').on(table.tenantId, table.classId, table.state),
    tierStateIdx: index('bookings_tier_state_idx').on(table.tenantId, table.workshopTierId, table.state),
    ptSessionIdx: index('bookings_pt_session_idx').on(table.tenantId, table.ptSessionId),
    qrTokenUnique: uniqueIndex('bookings_qr_token_unique').on(table.qrToken),
    codeUnique: uniqueIndex('bookings_code_unique').on(table.code),
    checkInStateIdx: index('bookings_check_in_state_idx').on(table.tenantId, table.checkInState),
    // Partial unique — stripe_payment_intent_id is nullable for non-workshop bookings.
    stripeIntentUnique: uniqueIndex('bookings_stripe_intent_unique')
      .on(table.stripePaymentIntentId)
      .where(sql`${table.stripePaymentIntentId} IS NOT NULL`),
    kindFkClass: check(
      'bookings_kind_class_fk',
      sql`${table.kind} <> 'class' OR (${table.classId} IS NOT NULL AND ${table.workshopId} IS NULL AND ${table.ptSessionId} IS NULL)`,
    ),
    kindFkWorkshop: check(
      'bookings_kind_workshop_fk',
      sql`${table.kind} <> 'workshop' OR (${table.workshopId} IS NOT NULL AND ${table.workshopTierId} IS NOT NULL AND ${table.classId} IS NULL AND ${table.ptSessionId} IS NULL)`,
    ),
    kindFkPt: check(
      'bookings_kind_pt_fk',
      sql`${table.kind} <> 'pt' OR (${table.ptSessionId} IS NOT NULL AND ${table.classId} IS NULL AND ${table.workshopId} IS NULL)`,
    ),
    kindMoney: check(
      'bookings_kind_money',
      sql`(${table.kind} = 'workshop' AND ${table.listPriceSgd} IS NOT NULL AND ${table.amountPaidSgd} IS NOT NULL)
        OR (${table.kind} <> 'workshop' AND ${table.listPriceSgd} IS NULL AND ${table.amountPaidSgd} IS NULL)`,
    ),
  }),
)

export const cancellations = pgTable(
  'cancellations',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    kind: cancellationKindEnum('kind').notNull(),
    source: cancellationSourceEnum('source').notNull(),
    wasWithinWindow: boolean('was_within_window').notNull(),
    wasWithinCap: boolean('was_within_cap').notNull(),
    refundFired: boolean('refund_fired').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }).notNull(),
  },
  table => ({
    clientCancelledIdx: index('cancellations_client_cancelled_idx').on(table.tenantId, table.clientId, table.cancelledAt),
  }),
)

export const checkIns = pgTable(
  'check_ins',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    checkedInByStaffId: uuid('checked_in_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
    method: checkinMethodEnum('method').notNull(),
  },
  table => ({
    bookingUnique: uniqueIndex('check_ins_booking_unique').on(table.bookingId),
  }),
)
