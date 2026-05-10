import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  hours: jsonb('hours'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
