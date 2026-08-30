import { pgTable, text, boolean, timestamp, uuid } from 'drizzle-orm/pg-core'
import { staffUsers } from './identity'
import { tenantIdColumn } from './tenancy'

export const featureFlags = pgTable('feature_flags', {
  tenantId: tenantIdColumn(),
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
    onDelete: 'restrict',
  }),
})
