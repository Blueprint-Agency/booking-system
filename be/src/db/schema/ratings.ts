import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { clients } from './identity'
import { instructors } from './catalog'
import { bookings } from './bookings'
import { classes, workshops } from './schedule'
import { ratingKindEnum } from '../enums'

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    kind: ratingKindEnum('kind').notNull(),
    classId: uuid('class_id').references(() => classes.id, { onDelete: 'restrict' }),
    workshopId: uuid('workshop_id').references(() => workshops.id, { onDelete: 'restrict' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    stars: integer('stars').notNull(),
    comment: text('comment'),
    ratedAt: timestamp('rated_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editWindowClosesAt: timestamp('edit_window_closes_at', { withTimezone: true }).notNull(),
  },
  table => ({
    bookingUnique: uniqueIndex('ratings_booking_unique').on(table.bookingId),
    instructorRatedIdx: index('ratings_instructor_rated_idx').on(table.instructorId, table.ratedAt),
    starsRange: check('ratings_stars_range', sql`${table.stars} BETWEEN 1 AND 5`),
    kindFk: check(
      'ratings_kind_fk',
      sql`(${table.kind} = 'class' AND ${table.classId} IS NOT NULL AND ${table.workshopId} IS NULL)
       OR (${table.kind} = 'workshop' AND ${table.workshopId} IS NOT NULL AND ${table.classId} IS NULL)`,
    ),
  }),
)
