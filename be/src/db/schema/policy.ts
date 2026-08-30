import { pgTable, uuid, integer, numeric, timestamp, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { staffUsers } from './identity'

const POLICY_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'
const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

export const globalPolicy = pgTable(
  'global_policy',
  {
    tenantId: tenantIdColumn(),
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
    // The **Leave Cap**: the greatest number of instructors who may be on STUDY
    // leave at the same moment. At least 1 — zero would make study leave
    // unobtainable — and not retroactive: lowering it leaves approved leave
    // exactly where it is. Who may not be away WITH whom is not a number and
    // does not live here; see `leave_conflicts` in db/schema/catalog.ts.
    studyLeaveCap: integer('study_leave_cap').notNull().default(1),
    // The **Cross-Location Add-On** rate, per month of the plan it extends (§5).
    // A rate rather than a price, which is why it lives here and not on the
    // catalogue. Read once at checkout and frozen onto the plan as the amount
    // paid, so repricing moves future purchases only.
    crossLocationRateSgd: numeric('cross_location_rate_sgd', { precision: 10, scale: 2 })
      .notNull()
      .default('30.00'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    singleton: check('global_policy_singleton', sql`${table.id} = '${sql.raw(POLICY_SINGLETON_ID)}'::uuid`),
    leaveCaps: check('global_policy_leave_caps_min_1', sql`${table.studyLeaveCap} >= 1`),
    crossLocationRateNonNegative: check(
      'global_policy_cross_location_rate_non_negative',
      sql`${table.crossLocationRateSgd} >= 0`,
    ),
  }),
)

export const ptBookingConfig = pgTable(
  'pt_booking_config',
  {
    tenantId: tenantIdColumn(),
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
