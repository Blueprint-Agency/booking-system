import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { classDifficultyEnum } from '../enums'

export const locations = pgTable(
  'locations',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    address: text('address'),
    gmapsUrl: text('gmaps_url'),
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => ({
    archivedIdx: index('locations_archived_idx').on(table.archivedAt),
    deletedIdx: index('locations_deleted_idx').on(table.deletedAt),
  }),
)

// ============================================================================
// rooms — physical spaces, location-scoped. Required when scheduling a class,
// workshop day, or PT session. A room hosts one session at a time (clash check
// lives in services/schedule/room-conflicts.ts).
// ============================================================================

export const rooms = pgTable(
  'rooms',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => ({
    locationArchivedIdx: index('rooms_location_archived_idx').on(
      table.locationId,
      table.archivedAt,
    ),
    deletedIdx: index('rooms_deleted_idx').on(table.deletedAt),
    locationNameLowerUnique: uniqueIndex('rooms_location_name_lower_unique').on(
      table.locationId,
      sql`lower(${table.name})`,
    ),
    capacityPositive: check('rooms_capacity_positive', sql`${table.capacity} > 0`),
  }),
)

// ============================================================================
// merch — studio goods (mats, props, apparel). No stock count, no online
// payment: the client browses, the studio hands the item over in person. Archive
// hides it from the client app; nothing references a row, so delete is a real
// DELETE rather than the soft-delete the schedulable tables need.
// ============================================================================

export const merch = pgTable(
  'merch',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    description: text('description'),
    priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
    imageR2Key: text('image_r2_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    archivedIdx: index('merch_archived_idx').on(table.archivedAt),
    priceNonNegative: check('merch_price_non_negative', sql`${table.priceSgd} >= 0`),
  }),
)

/**
 * A merch purchase. The item is handed over at the studio, so there is no
 * fulfilment state to track — the row IS the purchase history line.
 *
 * `title` and `amount_sgd` are frozen at purchase: the catalogue row can be
 * renamed, repriced or deleted afterwards and the member's history still reads
 * as what they actually bought. `merch_id` goes null on delete for the same
 * reason. A free item (price 0) is granted without the payment provider, so the
 * intent is nullable.
 */
export const merchOrders = pgTable(
  'merch_orders',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    merchId: uuid('merch_id').references(() => merch.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    amountSgd: numeric('amount_sgd', { precision: 10, scale: 2 }).notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    clientCreatedIdx: index('merch_orders_client_created_idx').on(table.clientId, table.createdAt),
    // One order per payment. Both the webhook and the confirmation page's
    // sync-session deliver the same purchase, so this is what makes the second
    // one a no-op. Postgres allows many NULLs, which is what free items want.
    intentUnique: uniqueIndex('merch_orders_intent_unique').on(table.stripePaymentIntentId),
  }),
)

export const classTypes: any = pgTable(
  'class_types',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    // Difficulty/level shown to clients and on the admin schedule detail. Defaults
    // to 'general' (all levels) for every existing and new type.
    difficulty: classDifficultyEnum('difficulty').notNull().default('general'),
    // Single-level hierarchy. Depth capped at 1 — enforced in service layer:
    // a child (parent_id IS NOT NULL) cannot itself become a parent.
    parentId: uuid('parent_id').references((): any => classTypes.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => ({
    archivedIdx: index('class_types_archived_idx').on(table.archivedAt),
    deletedIdx: index('class_types_deleted_idx').on(table.deletedAt),
    nameIdx: index('class_types_name_lower_idx').on(sql`lower(${table.name})`),
    parentIdx: index('class_types_parent_idx').on(table.parentId),
  }),
)

export const instructors = pgTable('instructors', {
  tenantId: tenantIdColumn(),
  staffUserId: uuid('staff_user_id')
    .primaryKey()
    .references(() => staffUsers.id, { onDelete: 'cascade' }),
  photoR2Key: text('photo_r2_key'),
  // Assigned Days: this instructor's yearly leave figures, set on their own
  // profile. Not a balance — the input to a Leave Year's Pool. 14/14/7 unless an
  // admin says otherwise, which is why the defaults live on the columns — study
  // leave is for every instructor, not something granted per person, so the
  // column default is also the backfill.
  annualLeaveDays: integer('annual_leave_days').notNull().default(14),
  medicalLeaveDays: integer('medical_leave_days').notNull().default(14),
  studyLeaveDays: integer('study_leave_days').notNull().default(7),
})

/**
 * A **Leave Conflict**: two instructors an admin has declared cannot be away at
 * the same time. Unordered — "Alice and Bob" is the same fact as "Bob and
 * Alice" — and that symmetry is a DATABASE guarantee, not a convention callers
 * remember: the CHECK forces the lower id into `instructor_a_id`, so the
 * reversed row cannot exist, and the primary key makes the pair unique.
 * Callers normalise before writing; these two constraints are the backstop.
 */
export const leaveConflicts = pgTable(
  'leave_conflicts',
  {
    tenantId: tenantIdColumn(),
    instructorAId: uuid('instructor_a_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    instructorBId: uuid('instructor_b_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.instructorAId, table.instructorBId] }),
    canonicalOrder: check(
      'leave_conflicts_canonical_order',
      sql`${table.instructorAId} < ${table.instructorBId}`,
    ),
  }),
)

export const instructorClassTypes = pgTable(
  'instructor_class_types',
  {
    tenantId: tenantIdColumn(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    classTypeId: uuid('class_type_id')
      .notNull()
      .references(() => classTypes.id, { onDelete: 'restrict' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.instructorId, table.classTypeId] }),
  }),
)
