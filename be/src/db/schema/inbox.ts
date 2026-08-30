import { pgTable, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { staffUsers } from './identity'
import { inboxItemTypeEnum } from '../enums'

// §4l — Inbox is purely a read-only notification feed.
// `source_pt_session_id`, `action_taken`, `action_at`, `action_by_staff_id` columns were
// dropped along with the `pt_request` type value. PT triage now lives on /admin/pt-requests
// backed by the `pt_requests` table (§4e).
export const inboxItems = pgTable(
  'inbox_items',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    type: inboxItemTypeEnum('type').notNull(),
    payload: jsonb('payload').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    readByStaffId: uuid('read_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    typeReadCreatedIdx: index('inbox_items_type_read_created_idx').on(
      table.type,
      table.readAt,
      table.createdAt,
    ),
  }),
)
