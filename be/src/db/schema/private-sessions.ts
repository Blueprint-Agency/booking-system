import { pgTable, uuid, text, timestamp, pgEnum, boolean, time, smallint, date } from 'drizzle-orm/pg-core'
import { users } from './users'
import { locations } from './locations'

export const privateRequestStatusEnum = pgEnum('private_request_status', [
  'pending', 'confirmed', 'expired', 'declined',
])

export const privateSessionRequests = pgTable('private_session_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  instructorId: uuid('instructor_id').notNull(),
  locationId: uuid('location_id').references(() => locations.id).notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  message: text('message'),
  status: privateRequestStatusEnum('status').default('pending'),
  responseNote: text('response_note'),
  respondedBy: uuid('responded_by').references(() => users.id),
  slaDeadline: timestamp('sla_deadline', { withTimezone: true }).notNull(),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const instructorAvailability = pgTable('instructor_availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  instructorId: uuid('instructor_id').notNull(),
  dayOfWeek: smallint('day_of_week'),
  overrideDate: date('override_date'),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  locationId: uuid('location_id').references(() => locations.id),
  isBlocked: boolean('is_blocked').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
