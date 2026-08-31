import { pgTable, text, boolean, timestamp, uuid, primaryKey } from 'drizzle-orm/pg-core'
import { staffUsers } from './identity'
import { tenantIdColumn } from './tenancy'

/**
 * One switch, for one tenant.
 *
 * `key` alone was the primary key, which made every flag a *platform* switch:
 * turning a feature on for one studio turned it on for all of them, and the
 * second studio to try would have collided on a row it cannot see. The key is
 * now the (tenant, key) pair, so each studio owns its own switchboard.
 *
 * `tenant_id` is `NOT NULL` because it is half of that primary key.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    tenantId: tenantIdColumn().notNull(),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    pk: primaryKey({ columns: [table.tenantId, table.key] }),
  }),
)
