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
  boolean,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { locations } from './catalog'
import {
  classPackageKindEnum,
  ptSessionTypeEnum,
  packageStatusEnum,
  clientPackageKindEnum,
  promotionParentEnum,
  promotionKindEnum,
  promotionStatusEnum,
  promoCodeKindEnum,
  promoCodeStatusEnum,
  promoCodeProductEnum,
  promoCodeRedemptionStatusEnum,
} from '../enums'

// ---------- class_packages (admin catalogue, §4d, §5) ----------

export const classPackages = pgTable(
  'class_packages',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    kind: classPackageKindEnum('kind').notNull(),
    credits: integer('credits'),
    validityDays: integer('validity_days'),
    // Duration is whole calendar months (spec §4). A 6-month plan activated on
    // 15 Jan ends 15 Jul, not 180 days later.
    durationMonths: integer('duration_months'),
    priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
    status: packageStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => ({
    statusKindIdx: index('class_packages_status_kind_idx').on(table.status, table.kind),
    deletedIdx: index('class_packages_deleted_idx').on(table.deletedAt),
    // Kind-specific column requirements per §4d:
    //  - credit_bundle → credits NOT NULL, validity_days NOT NULL, duration_months NULL
    //  - unlimited     → credits NULL, validity_days NULL, duration_months NOT NULL
    //  - trial         → credits NOT NULL, validity_days NOT NULL, duration_months NULL
    // Trial validity is REQUIRED (spec §3): "never expires" leaves the domain —
    // a null expiry now means Dormant, which only an Unlimited Plan can be.
    kindFields: check(
      'class_packages_kind_fields',
      sql`
        (${table.kind} = 'credit_bundle'
          AND ${table.credits} IS NOT NULL
          AND ${table.validityDays} IS NOT NULL
          AND ${table.durationMonths} IS NULL)
        OR
        (${table.kind} = 'unlimited'
          AND ${table.credits} IS NULL
          AND ${table.validityDays} IS NULL
          AND ${table.durationMonths} IS NOT NULL)
        OR
        (${table.kind} = 'trial'
          AND ${table.credits} IS NOT NULL
          AND ${table.validityDays} IS NOT NULL
          AND ${table.durationMonths} IS NULL)
      `,
    ),
  }),
)

// ---------- pt_packages (§6) ----------

export const ptPackages = pgTable('pt_packages', {
  tenantId: tenantIdColumn(),
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
    tenantId: tenantIdColumn(),
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

// ---------- promo_codes (spec-pre-launch-batch.md §9) ----------
// A Promo Code is typed by the member, reaches across products and is capped.
// A Promotion (above) applies itself to one product inside a window. The two
// share a shape and nothing else, so they get separate tables rather than one
// table with a nullable code column every query would have to filter on.
//
// No `starts_at`: a code does nothing until someone hands it out, and
// `archived` already covers "made, not yet running".
export const promoCodes = pgTable(
  'promo_codes',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Stored normalised — trimmed and upper-cased. Generated and custom codes
    // share this one namespace behind this one unique index, so a custom code
    // cannot collide with a generated one by construction.
    code: text('code').notNull(),
    label: text('label').notNull(),
    kind: promoCodeKindEnum('kind').notNull(),
    percentOff: integer('percent_off'),
    amountOffSgd: numeric('amount_off_sgd', { precision: 10, scale: 2 }),
    /** null means uncapped. */
    maxRedemptions: integer('max_redemptions'),
    /** null means never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** true means no promo_code_products rows — enforced in the service, not here. */
    appliesToAll: boolean('applies_to_all').notNull().default(false),
    status: promoCodeStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByStaffId: uuid('created_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
  },
  table => ({
    codeUnique: uniqueIndex('promo_codes_code_unique').on(table.code),
    kindFields: check(
      'promo_codes_kind_fields',
      sql`
        (${table.kind} = 'percent'
          AND ${table.percentOff} IS NOT NULL
          AND ${table.percentOff} BETWEEN 1 AND 99
          AND ${table.amountOffSgd} IS NULL)
        OR
        (${table.kind} = 'amount'
          AND ${table.amountOffSgd} IS NOT NULL
          AND ${table.amountOffSgd} > 0
          AND ${table.percentOff} IS NULL)
      `,
    ),
    codeFormat: check('promo_codes_code_format', sql`${table.code} ~ '^[A-Z0-9-]{3,24}$'`),
    maxPositive: check(
      'promo_codes_max_positive',
      sql`${table.maxRedemptions} IS NULL OR ${table.maxRedemptions} > 0`,
    ),
  }),
)

// ---------- promo_code_products (scope rows) ----------
// `product_id` carries NO foreign key, exactly like promotions.parent_id — the
// parent table varies, so referential integrity sits in the service layer.
// Scoping is at workshop level, never workshop tier. Corporate packages are
// absent from the enum entirely: corporate is direct-pay and not scopable.
export const promoCodeProducts = pgTable(
  'promo_code_products',
  {
    tenantId: tenantIdColumn(),
    promoCodeId: uuid('promo_code_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'cascade' }),
    productType: promoCodeProductEnum('product_type').notNull(),
    productId: uuid('product_id').notNull(),
  },
  table => ({
    pk: primaryKey({
      name: 'promo_code_products_pkey',
      columns: [table.promoCodeId, table.productType, table.productId],
    }),
  }),
)

// ---------- promo_code_redemptions ----------
// One member's single use of one Promo Code. Held when their checkout begins,
// Consumed when payment succeeds. A used place is
// `status = 'consumed' OR held_until > now()`, so an abandoned Hold stops
// counting on its own — nothing sweeps it.
export const promoCodeRedemptions = pgTable(
  'promo_code_redemptions',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    promoCodeId: uuid('promo_code_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    status: promoCodeRedemptionStatusEnum('status').notNull(),
    /** When the Hold lapses. Set to the payment session's own expiry. */
    heldUntil: timestamp('held_until', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** null on a $0 grant, which skips the payment provider entirely. */
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    /** The money actually taken off, frozen. */
    discountSgd: numeric('discount_sgd', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    // The one-use-per-member rule. It also makes the Hold idempotent: a member
    // who abandons and retries updates their own row. It is **partial** (§14):
    // a refunded Redemption is not deleted — the ledger is the only evidence of
    // a buy-refund-buy loop — so it must sit outside the index for the member to
    // be able to use the code again.
    oncePerClient: uniqueIndex('promo_code_redemptions_code_client_unique')
      .on(table.promoCodeId, table.clientId)
      .where(sql`${table.status} <> 'refunded'`),
  }),
)

// ---------- client_packages (per-client purchased instances — entitlement ledger) ----------

export const clientPackages = pgTable(
  'client_packages',
  {
    tenantId: tenantIdColumn(),
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
    // The Promo Code the member typed, frozen beside the Promotion (§11). The
    // identifier and not the label, because staff may edit the label later; the
    // money taken off is frozen on the Redemption row. A denormalisation of the
    // ledger that earns its place — the payment intent is null on a $0 grant, so
    // the ledger cannot be joined back to the purchase in every case.
    appliedPromoCodeId: uuid('applied_promo_code_id').references(() => promoCodes.id, {
      onDelete: 'restrict',
    }),
    // Home Location — the one Location an Unlimited Plan covers (§1). Only an
    // Unlimited Plan carries one; every other kind is Location-agnostic.
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
    // Frozen copy of the catalogue Duration in calendar months (§4). Frozen because
    // activation reads it later, and the live catalogue row is admin-editable.
    durationMonths: integer('duration_months'),
    // The **Cross-Location Add-On** (§5): null means this plan Covers its Home
    // Location only; non-null means it Covers both, and the value IS what the
    // member paid. A column rather than a product, because the Add-On cannot
    // exist without a plan, booking needs no join to see it, and Add-On revenue
    // separates from plan revenue for free.
    crossLocationPaidSgd: numeric('cross_location_paid_sgd', { precision: 10, scale: 2 }),
    creditsOrSessionsRemaining: integer('credits_or_sessions_remaining'),
    // Null ONLY for a Dormant Unlimited Plan — a plan bought while another was
    // still live, whose clock starts at Activation (§3). It never means "never expires".
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
    amountPaidSgd: numeric('amount_paid_sgd', { precision: 10, scale: 2 }).notNull(),
    // List Price frozen at purchase (§15) — NOT NULL on every row including free
    // ones, so a comp grant or $0 trial reads as 100% off rather than vanishing.
    // The money off is derived (list minus paid) and never stored.
    listPriceSgd: numeric('list_price_sgd', { precision: 10, scale: 2 }).notNull(),
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
    // One Activated Unlimited Plan per client (§6). A Dormant plan (null expiry)
    // sits outside the predicate, which is what lets a renewal wait beside the
    // running one. The renewal rule in the purchase path is the enforcement;
    // this index is the backstop that catches a race or a bug.
    activatedUnlimitedUniquePerClient: uniqueIndex(
      'client_packages_one_activated_unlimited_per_client',
    )
      .on(table.clientId)
      .where(
        sql`${table.kind} = 'unlimited' AND ${table.active} AND ${table.expiresAt} IS NOT NULL`,
      ),
    nonNegBalance: check(
      'client_packages_non_negative_balance',
      sql`${table.creditsOrSessionsRemaining} IS NULL OR ${table.creditsOrSessionsRemaining} >= 0`,
    ),
    // The folded check (§1 + §3). Strict, no grandfathering: an unusable plan is
    // impossible at the database level rather than something booking has to detect.
    // Only an Unlimited Plan carries a Location and a Duration, and only an
    // Unlimited Plan may have a null expiry (which means Dormant).
    kindFields: check(
      'client_packages_kind_fields',
      sql`
        (${table.kind} = 'unlimited'
          AND ${table.locationId} IS NOT NULL
          AND ${table.durationMonths} IS NOT NULL)
        OR
        (${table.kind} <> 'unlimited'
          AND ${table.locationId} IS NULL
          AND ${table.durationMonths} IS NULL
          AND ${table.crossLocationPaidSgd} IS NULL
          AND ${table.expiresAt} IS NOT NULL)
      `,
    ),
  }),
)

// ---------- corporate_packages (admin catalogue; surfaced to fe-client as the Corporate tab) ----------

export const corporatePackages = pgTable(
  'corporate_packages',
  {
    tenantId: tenantIdColumn(),
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
