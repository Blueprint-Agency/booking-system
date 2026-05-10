import { pgTable, uuid, text, integer, numeric, timestamp } from 'drizzle-orm/pg-core'
import { locations } from './locations'

export const workshops = pgTable('workshops', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  locationId: uuid('location_id').references(() => locations.id).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  capacity: integer('capacity').notNull(),
  priceEarly: numeric('price_early', { precision: 10, scale: 2 }),
  priceStandard: numeric('price_standard', { precision: 10, scale: 2 }).notNull(),
  priceMember: numeric('price_member', { precision: 10, scale: 2 }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
