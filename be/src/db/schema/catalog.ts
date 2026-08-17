import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { staffUsers } from './identity'
import { classDifficultyEnum } from '../enums'

export const locations = pgTable(
  'locations',
  {
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

export const classTypes: any = pgTable(
  'class_types',
  {
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
  // **Cover Group** membership: the instructors an admin has ticked as covering
  // each other. One studio-wide set, false for everyone until somebody is
  // ticked — which is what makes the Leave Cap inert on an untouched studio.
  inCoverGroup: boolean('in_cover_group').notNull().default(false),
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
