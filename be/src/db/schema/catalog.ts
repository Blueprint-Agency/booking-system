import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
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
  // profile. Not a balance — the input to a Leave Year's Pool. 14/14 unless an
  // admin says otherwise, which is why the default lives on the column.
  annualLeaveDays: integer('annual_leave_days').notNull().default(14),
  medicalLeaveDays: integer('medical_leave_days').notNull().default(14),
})

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
