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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { classDifficultyEnum, instructorPermissionEnum } from '../enums'

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
    archivedIdx: index('locations_archived_idx').on(table.tenantId, table.archivedAt),
    deletedIdx: index('locations_deleted_idx').on(table.tenantId, table.deletedAt),
  }),
)

// ============================================================================
// entities — a line of practice a studio sells packages for (be/CONTEXT.md
// § Entity). Named by the studio: Yoga, Pilates. A studio always has at least
// one; every studio created or migrated starts with "All classes". Nothing
// references one yet — Class Types and catalogue packages take an `entity_id`
// in later changes, so an archive's "still in use" counts are zero until then.
// Name and slug are unique per Tenant, case-insensitively, among the live
// (non-archived) rows: an archived line gives its name back.
// ============================================================================

export const entities = pgTable(
  'entities',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Display order, ascending. Gaps are fine; the order is what counts. */
    position: integer('position').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    positionIdx: index('entities_position_idx').on(table.tenantId, table.position),
    nameLiveUnique: uniqueIndex('entities_name_live_unique')
      .on(table.tenantId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    slugLiveUnique: uniqueIndex('entities_slug_live_unique')
      .on(table.tenantId, sql`lower(${table.slug})`)
      .where(sql`${table.archivedAt} IS NULL`),
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
      table.tenantId,
      table.locationId,
      table.archivedAt,
    ),
    deletedIdx: index('rooms_deleted_idx').on(table.tenantId, table.deletedAt),
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
    archivedIdx: index('merch_archived_idx').on(table.tenantId, table.archivedAt),
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
    // Null once the member is permanently deleted; the sale stays.
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
    merchId: uuid('merch_id').references(() => merch.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    amountSgd: numeric('amount_sgd', { precision: 10, scale: 2 }).notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    clientIdFkIdx: index('merch_orders_client_id_fk_idx').on(table.clientId),
    merchIdFkIdx: index('merch_orders_merch_id_fk_idx').on(table.merchId),
    clientCreatedIdx: index('merch_orders_client_created_idx').on(table.tenantId, table.clientId, table.createdAt),
    // One order per payment. Both the webhook and the confirmation page's
    // sync-session deliver the same purchase, so this is what makes the second
    // one a no-op. Postgres allows many NULLs, which is what free items want.
    // Per Tenant: every lookup already pairs the intent with a tenant id, and a
    // studio's archive must be restorable beside the studio it came from.
    intentUnique: uniqueIndex('merch_orders_intent_unique').on(
      table.tenantId,
      table.stripePaymentIntentId,
    ),
  }),
)

const classTypesTable = pgTable(
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
    parentId: uuid('parent_id').references((): AnyPgColumn => classTypesTable.id, { onDelete: 'restrict' }),
    // The Entity (line of practice) this type belongs to, on EVERY row: a
    // sub-type stores its parent's, kept equal by the service (a move rewrites
    // the children in the same transaction). Nullable this deploy
    // (migrations README rule 0); the service and routes require it, and NOT NULL
    // is a later deploy. Reads of `classTypes.entityId` are untyped (`any` below).
    entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => ({
    entityIdFkIdx: index('class_types_entity_id_fk_idx').on(table.entityId),
    parentIdFkIdx: index('class_types_parent_id_fk_idx').on(table.parentId),
    archivedIdx: index('class_types_archived_idx').on(table.tenantId, table.archivedAt),
    deletedIdx: index('class_types_deleted_idx').on(table.tenantId, table.deletedAt),
    nameIdx: index('class_types_name_lower_idx').on(table.tenantId, sql`lower(${table.name})`),
    parentIdx: index('class_types_parent_idx').on(table.tenantId, table.parentId),
  }),
)

/** The table's own name, which `classTypes` below cannot give: it is typed `any` (see there). */
export type ClassTypesTableName = (typeof classTypesTable)['_']['name']

/**
 * Typed `any` as it always was: code reads its columns loosely. `classTypesTable`
 * is the same table with its real type, so that `TableName` (`../table-names`)
 * still finds the table's name.
 */
export const classTypes: any = classTypesTable

export const instructors = pgTable('instructors', {
  tenantId: tenantIdColumn(),
  staffUserId: uuid('staff_user_id')
    .primaryKey()
    .references(() => staffUsers.id, { onDelete: 'cascade' }),
  // Retired: the picture is the staff member's own, on `staff_users`, where
  // `instructor_photos_to_staff` copied it. Nothing reads this one. The build
  // before that migration still does, during the deploy and after a rollback
  // (`src/db/migrations/README.md` rule 0), so a staff member's picture change
  // writes the same key here too (`services/profile-pictures/pictures.ts`).
  // That dual-write ends when a later deploy drops this column.
  photoR2Key: text('photo_r2_key'),
  // The Instructor Permissions an Admin has granted (be/docs/adr/0012). The
  // default is all three, and it lives here so every path that makes an
  // instructors row — invitation, role change, provisioning, import, restore of
  // an archive taken before the column — gets all three without knowing it.
  permissions: instructorPermissionEnum('permissions')
    .array()
    .notNull()
    .default(sql`'{schedule_classes,take_pt_bookings,manage_rosters}'::instructor_permission[]`),
  // Assigned Days are not here: leave belongs to a staff member, admins
  // included, so they live on `staff_users` (be/docs/adr/0009).
}, table => ({
  tenantIdFkIdx: index('instructors_tenant_id_fk_idx').on(table.tenantId),
}))

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
    instructorBIdFkIdx: index('leave_conflicts_instructor_b_id_fk_idx').on(table.instructorBId),
    tenantIdFkIdx: index('leave_conflicts_tenant_id_fk_idx').on(table.tenantId),
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
    classTypeIdFkIdx: index('instructor_class_types_class_type_id_fk_idx').on(table.classTypeId),
    tenantIdFkIdx: index('instructor_class_types_tenant_id_fk_idx').on(table.tenantId),
    pk: primaryKey({ columns: [table.instructorId, table.classTypeId] }),
  }),
)
