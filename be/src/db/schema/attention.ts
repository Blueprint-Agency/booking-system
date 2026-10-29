import { pgTable, uuid, jsonb, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { clients, staffUsers } from './identity'
import { staffUpdateKindEnum } from '../enums'

/**
 * Staff Updates: things that happened which a staff member should
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

/**
 * Dismissals: an admin's studio-wide decision that an Attention
 * item of a dismissable kind needs nothing done ("keep waiting", "keep the
 * class"). It is not a read flag: it hides the item for every admin.
 *
 * `subject_id` is the item's subject (a Purchase, a class), with no FK because
 * what it points at depends on `kind`. `kind` is text, not an enum, so a new
 * dismissable kind needs no migration: the registry says which kinds exist. The
 * row names no member, so permanent deletion of a member leaves it alone.
 */
export const attentionDismissals = pgTable(
  'attention_dismissals',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    kind: text('kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    dismissedByStaffId: uuid('dismissed_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    dismissedByFkIdx: index('attention_dismissals_dismissed_by_staff_id_fk_idx').on(table.dismissedByStaffId),
    itemUnique: uniqueIndex('attention_dismissals_tenant_kind_subject_uq').on(
      table.tenantId,
      table.kind,
      table.subjectId,
    ),
  }),
)
