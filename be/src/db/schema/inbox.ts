import { pgTable, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { staffUsers } from './identity'
import { ptSessions } from './schedule'
import { inboxItemTypeEnum, inboxActionEnum } from '../enums'

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    type: inboxItemTypeEnum('type').notNull(),
    payload: jsonb('payload').notNull(),
    sourcePtSessionId: uuid('source_pt_session_id').references(() => ptSessions.id, {
      onDelete: 'restrict',
    }),
    readAt: timestamp('read_at', { withTimezone: true }),
    readByStaffId: uuid('read_by_staff_id').references(() => staffUsers.id, { onDelete: 'restrict' }),
    actionTaken: inboxActionEnum('action_taken'),
    actionAt: timestamp('action_at', { withTimezone: true }),
    actionByStaffId: uuid('action_by_staff_id').references(() => staffUsers.id, {
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
    ptSessionIdx: index('inbox_items_pt_session_idx').on(table.sourcePtSessionId),
  }),
)
