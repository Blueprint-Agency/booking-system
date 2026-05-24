import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  bigserial,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { clients, staffUsers } from './identity'
import {
  classPackageKindEnum,
  ptSessionTypeEnum,
  packageStatusEnum,
  clientPackageKindEnum,
  promotionParentEnum,
  promotionKindEnum,
  promotionStatusEnum,
} from '../enums'

// ---------- class_packages (admin catalogue, §4d, §5) ----------

export const classPackages = pgTable(
  'class_packages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    kind: classPackageKindEnum('kind').notNull(),
    credits: integer('credits'),
    validityDays: integer('validity_days'),
    durationDays: integer('duration_days'),
    priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
    status: packageStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => ({
    statusKindIdx: index('class_packages_status_kind_idx').on(table.status, table.kind),
    deletedIdx: index('class_packages_deleted_idx').on(table.deletedAt),
    // Kind-specific column requirements per §4d:
    //  - credit_bundle → credits NOT NULL, validity_days NOT NULL, duration_days NULL
    //  - unlimited     → credits NULL, validity_days NULL, duration_days NOT NULL
    //  - trial         → credits NOT NULL, duration_days NULL (validity_days nullable)
    kindFields: check(
      'class_packages_kind_fields',
      sql`
        (${table.kind} = 'credit_bundle'
          AND ${table.credits} IS NOT NULL
          AND ${table.validityDays} IS NOT NULL
          AND ${table.durationDays} IS NULL)
        OR
        (${table.kind} = 'unlimited'
          AND ${table.credits} IS NULL
          AND ${table.validityDays} IS NULL
          AND ${table.durationDays} IS NOT NULL)
        OR
        (${table.kind} = 'trial'
          AND ${table.credits} IS NOT NULL
          AND ${table.durationDays} IS NULL)
      `,
    ),
  }),
)

// ---------- pt_packages (§6) ----------

export const ptPackages = pgTable('pt_packages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  description: text('description'),
  sessionType: ptSessionTypeEnum('session_type').notNull(),
  numSessions: integer('num_sessions').notNull(),
  priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
  status: packageStatusEnum('status').notNull().default('active'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// ---------- promotions (§4d) — polymorphic ----------
// Parent table varies (class_packages | pt_packages | workshops), so parent_id has NO DB FK —
// referential integrity enforced at app layer (purchase service). Best-price-wins resolved
// at purchase time across in-window promotions; winning row frozen onto client_packages /
// bookings via `applied_promotion_id`.
export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    parentType: promotionParentEnum('parent_type').notNull(),
    parentId: uuid('parent_id').notNull(),
    label: text('label').notNull(),
    kind: promotionKindEnum('kind').notNull(),
    percentOff: integer('percent_off'),
    specialPriceSgd: numeric('special_price_sgd', { precision: 10, scale: 2 }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: promotionStatusEnum('status').notNull().default('active'),
    // bigserial for deterministic tie-break when two promotions yield identical effective
    // prices — lowest sort_id wins (per fe-client-features.md §6.1).
    sortId: bigserial('sort_id', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByStaffId: uuid('created_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
  },
  table => ({
    // Primary in-window lookup at purchase time.
    parentLookupIdx: index('promotions_parent_lookup_idx').on(
      table.parentType,
      table.parentId,
      table.status,
      table.startsAt,
      table.endsAt,
    ),
    sortIdx: index('promotions_sort_idx').on(table.sortId),
    endsAfterStarts: check(
      'promotions_ends_after_starts',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    kindFields: check(
      'promotions_kind_fields',
      sql`
        (${table.kind} = 'percent'
          AND ${table.percentOff} IS NOT NULL
          AND ${table.percentOff} BETWEEN 1 AND 99
          AND ${table.specialPriceSgd} IS NULL)
        OR
        (${table.kind} = 'special_price'
          AND ${table.specialPriceSgd} IS NOT NULL
          AND ${table.percentOff} IS NULL)
      `,
    ),
  }),
)

// ---------- client_packages (per-client purchased instances — entitlement ledger) ----------

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
    // Frozen at purchase time so a later change to the promotion row doesn't rewrite history (§4d).
    appliedPromotionId: uuid('applied_promotion_id').references(() => promotions.id, {
      onDelete: 'restrict',
    }),
    creditsOrSessionsRemaining: integer('credits_or_sessions_remaining'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
    amountPaidSgd: numeric('amount_paid_sgd', { precision: 10, scale: 2 }).notNull(),
    // Nullable per §4d — null for admin-issued grants (§16) and free trial passes at 0 SGD.
    stripePaymentIntentId: text('stripe_payment_intent_id'),
  },
  table => ({
    clientKindIdx: index('client_packages_client_kind_idx').on(table.clientId, table.kind),
    clientExpiryIdx: index('client_packages_client_expiry_idx').on(table.clientId, table.expiresAt),
    // Partial unique on stripe_payment_intent_id (now nullable per spec).
    stripeIntentUnique: uniqueIndex('client_packages_stripe_intent_unique')
      .on(table.stripePaymentIntentId)
      .where(sql`${table.stripePaymentIntentId} IS NOT NULL`),
    // One-trial-per-client-ever invariant (fe-client-features.md §6.1) — partial unique.
    // A previously-purchased trial (active OR expired) blocks any further trial purchase;
    // the purchase service catches the unique-violation and returns `409 trial_already_used`.
    trialUniquePerClient: uniqueIndex('client_packages_trial_unique_per_client')
      .on(table.clientId)
      .where(sql`${table.kind} = 'trial'`),
    nonNegBalance: check(
      'client_packages_non_negative_balance',
      sql`${table.creditsOrSessionsRemaining} IS NULL OR ${table.creditsOrSessionsRemaining} >= 0`,
    ),
  }),
)

// ---------- corporate_packages (admin-only catalogue, NOT visible to fe-client) ----------

export const corporatePackages = pgTable(
  'corporate_packages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
    status: packageStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByStaffId: uuid('created_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
  },
  table => ({
    statusIdx: index('corporate_packages_status_idx').on(table.status),
    deletedIdx: index('corporate_packages_deleted_idx').on(table.deletedAt),
    pricePositive: check('corporate_packages_price_positive', sql`${table.priceSgd} >= 0`),
  }),
)
