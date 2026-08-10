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
    // Yearly instructor leave allowances, in days. Global — deliberately no
    // per-instructor override. The DB default is what backfills the existing
    // singleton row when this migration runs.
    annualLeaveDays: integer('annual_leave_days').notNull().default(14),
    medicalLeaveDays: integer('medical_leave_days').notNull().default(14),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    singleton: check('global_policy_singleton', sql`${table.id} = '${sql.raw(POLICY_SINGLETON_ID)}'::uuid`),
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
