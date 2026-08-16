import { pgTable, uuid, integer, timestamp, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { staffUsers } from './identity'

const POLICY_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'
const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

export const globalPolicy = pgTable(
  'global_policy',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`'${sql.raw(POLICY_SINGLETON_ID)}'::uuid`),
    cancelCapCount: integer('cancel_cap_count').notNull(),
    cancelCapCycleDays: integer('cancel_cap_cycle_days').notNull(),
    classWindowHours: integer('class_window_hours').notNull(),
    ptWindowHours: integer('pt_window_hours').notNull(),
    // The one studio-wide leave figure: the ceiling on unused ANNUAL days
    // carrying into the next Leave Year. Assigned Days are NOT here — they live
    // per instructor, on `instructors` (see db/schema/catalog.ts). Changing this
    // affects Leave Years that have yet to be materialised; a Pool already
    // stored is frozen and does not move.
    leaveCarryOverCapDays: integer('leave_carry_over_cap_days').notNull().default(14),
    // The two **Leave Caps**: the greatest number of instructors from one set who
    // may be away at the same moment. The first counts the Cover Group, every
    // Leave Type; the second counts study leave across every instructor. Both are
    // at least 1 — zero would freeze annual leave studio-wide — and neither is
    // retroactive: lowering one leaves approved leave exactly where it is.
    coverGroupLeaveCap: integer('cover_group_leave_cap').notNull().default(1),
    studyLeaveCap: integer('study_leave_cap').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    singleton: check('global_policy_singleton', sql`${table.id} = '${sql.raw(POLICY_SINGLETON_ID)}'::uuid`),
    leaveCaps: check(
      'global_policy_leave_caps_min_1',
      sql`${table.coverGroupLeaveCap} >= 1 AND ${table.studyLeaveCap} >= 1`,
    ),
  }),
)

export const ptBookingConfig = pgTable(
  'pt_booking_config',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`'${sql.raw(PT_CONFIG_SINGLETON_ID)}'::uuid`),
    bookInAdvanceDays: integer('book_in_advance_days').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    singleton: check('pt_booking_config_singleton', sql`${table.id} = '${sql.raw(PT_CONFIG_SINGLETON_ID)}'::uuid`),
  }),
)
