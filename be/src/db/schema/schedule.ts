import { pgTable, uuid, text, integer, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { locations } from './locations'
import { users } from './users'

export const classInstanceStatusEnum = pgEnum('class_instance_status', ['scheduled', 'completed', 'cancelled'])

export const classTemplates = pgTable('class_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  durationMin: integer('duration_min').notNull(),
  defaultCapacity: integer('default_capacity').notNull(),
  defaultInstructorId: uuid('default_instructor_id'),
  locationId: uuid('location_id').references(() => locations.id).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const classInstances = pgTable('class_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').references(() => classTemplates.id),
  title: text('title').notNull(),
  instructorId: uuid('instructor_id').notNull(),
  locationId: uuid('location_id').references(() => locations.id).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  capacity: integer('capacity').notNull(),
  waitlistEnabled: boolean('waitlist_enabled').default(false),
  status: classInstanceStatusEnum('status').default('scheduled'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: uuid('cancelled_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
