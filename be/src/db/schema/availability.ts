import { pgTable, uuid, integer, time, timestamp, index, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { instructors } from './catalog'

export const instructorAvailabilityRecurring = pgTable(
  'instructor_availability_recurring',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
  },
  table => ({
    instructorWeekdayIdx: index('avail_recurring_instructor_weekday_idx').on(
      table.instructorId,
      table.weekday,
    ),
    weekdayRange: check('avail_weekday_range', sql`${table.weekday} BETWEEN 0 AND 6`),
    timeOrder: check('avail_time_order', sql`${table.endTime} > ${table.startTime}`),
  }),
)

export const instructorAvailabilityOneoff = pgTable(
  'instructor_availability_oneoff',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  },
  table => ({
    instructorStartsIdx: index('avail_oneoff_instructor_starts_idx').on(table.instructorId, table.startsAt),
    endsAfterStarts: check('avail_oneoff_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
  }),
)
