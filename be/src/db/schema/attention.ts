import { pgTable, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { staffUpdateKindEnum } from '../enums'

/**
 * Staff Updates (#476, #490): things that happened which a staff member should
 * know but needn't act on. One row per recipient, written in the transaction of
 * the act that caused it, so each person has their own read state.
 *
 * The payload is a snapshot (names, dates), so a row still reads correctly after
 * what it is about changes or is deleted. Needs action items, by contrast, are
 * derived and have no table (services/attention).
 */
export const staffUpdates = pgTable(
  'staff_updates',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    recipientStaffId: uuid('recipient_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    kind: staffUpdateKindEnum('kind').notNull(),
    payload: jsonb('payload').notNull(),
    /** The member this update names, if any: permanently deleting them deletes it. */
    subjectClientId: uuid('subject_client_id').references(() => clients.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  table => ({
    recipientFkIdx: index('staff_updates_recipient_staff_id_fk_idx').on(table.recipientStaffId),
    subjectClientFkIdx: index('staff_updates_subject_client_id_fk_idx').on(table.subjectClientId),
    // The bubble's unread count and the tab's newest-first page.
    recipientReadCreatedIdx: index('staff_updates_recipient_read_created_idx').on(
      table.tenantId,
      table.recipientStaffId,
      table.readAt,
      table.createdAt,
    ),
  }),
)
