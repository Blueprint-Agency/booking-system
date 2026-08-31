import { pgTable, uuid, integer, numeric, timestamp, check, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { staffUsers } from './identity'

/**
 * Both tables here used to be *platform* singletons: a `CHECK (id = '<fixed
 * uuid>')` meant exactly one row could ever exist. That is the right constraint
 * for one studio and a data leak for two — a second tenant could not own a
 * policy row, so it would have been served tenant #1's caps and windows.
 *
 * They are now singletons **per tenant**: the check is gone, the id is
 * generated, and a unique index on `tenant_id` is what keeps it to one row each.
 */
export const globalPolicy = pgTable(
  'global_policy',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
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
    oneRowPerTenant: uniqueIndex('global_policy_tenant_uniq').on(table.tenantId),
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
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bookInAdvanceDays: integer('book_in_advance_days').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
  },
  table => ({
    oneRowPerTenant: uniqueIndex('pt_booking_config_tenant_uniq').on(table.tenantId),
  }),
)
