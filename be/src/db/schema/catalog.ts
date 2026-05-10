import { pgTable, uuid, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { staffUsers } from './identity'

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    address: text('address'),
    gmapsUrl: text('gmaps_url'),
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  table => ({
    archivedIdx: index('locations_archived_idx').on(table.archivedAt),
  }),
)

export const classTypes = pgTable(
  'class_types',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  table => ({
    archivedIdx: index('class_types_archived_idx').on(table.archivedAt),
    nameIdx: index('class_types_name_lower_idx').on(sql`lower(${table.name})`),
  }),
)

export const instructors = pgTable('instructors', {
  staffUserId: uuid('staff_user_id')
    .primaryKey()
    .references(() => staffUsers.id, { onDelete: 'cascade' }),
  photoR2Key: text('photo_r2_key'),
  bio: text('bio'),
  phone: text('phone'),
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
