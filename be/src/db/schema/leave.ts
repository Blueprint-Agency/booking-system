import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  numeric,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import { staffUsers } from './identity'
import { instructors } from './catalog'
import { leaveTypeEnum, leaveStatusEnum, leaveHalfDayEnum } from '../enums'

/**
 * Instructor leave requests — see docs/md/spec-instructor-leave-pools.md.
 *
 * There is deliberately NO counter of days used anywhere. Taken and Committed
 * are derived by summing `days` over this table (see services/leave/rules.ts),
 * so cancelling restores days for free. The one number that IS stored is the
 * yearly grant — see `leavePools` below — and storing a grant is not storing a
 * balance: nothing has to be written back when a request ends.
 *
 * `leaveYear` is stored rather than derived at read time so that changing an
 * instructor's Assigned Days or adjusting a Pool, or crossing a year boundary,
 * cannot alter what a past request counted against.
 *
 * Dates are plain `date` — Asia/Singapore calendar days, not instants.
 */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Keyed to the instructor extension table: only instructors take leave.
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    type: leaveTypeEnum('type').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    halfDay: leaveHalfDayEnum('half_day').notNull().default('none'),
    /** Days consumed, one decimal — a half day is 0.5. */
    days: numeric('days', { precision: 4, scale: 1 }).notNull(),
    leaveYear: integer('leave_year').notNull(),
    status: leaveStatusEnum('status').notNull().default('pending'),
    reason: text('reason').notNull(),
    decisionReason: text('decision_reason'),
    decidedByStaffId: uuid('decided_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Private-bucket object key for the Supporting Document (upload lands later,
     *  and only on a medical or study request). Stored rather than recomputed, so
     *  objects written under the old prefix keep resolving. */
    supportingDocumentR2Key: text('supporting_document_r2_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    // The balance query: one instructor's rows for one leave year.
    balanceIdx: index('leave_requests_instructor_year_idx').on(table.tenantId, table.instructorId, table.leaveYear),
    // The calendar / clash queries: everything overlapping a date window.
    datesIdx: index('leave_requests_dates_idx').on(table.tenantId, table.startDate, table.endDate),
    statusIdx: index('leave_requests_status_idx').on(table.tenantId, table.status),
  }),
)

/**
 * The **Pool** for one instructor, one Leave Type, one Leave Year — Assigned
 * Days plus Carried Days, frozen the first time that year is read.
 *
 * A stored **grant**, NOT a stored balance. Taken and Committed stay derived by
 * summing `leave_requests`, so withdraw, cancel, reject and revoke still give
 * the days back with no code at all — the row simply stops matching the filter.
 * Nothing is ever written here when a request changes status; a future column
 * holding Taken or Remaining would give that property up and should be refused.
 *
 * Stored rather than derived because carry-over makes a year's Pool depend on
 * the previous year's Remaining: derived, editing an instructor's Assigned Days
 * would reach backwards through every year they have worked. See
 * docs/adr/0001-per-instructor-leave-pools-with-carry-over.md.
 *
 * The primary key is the (instructor, type, year) triple, which is what makes
 * lazy materialisation idempotent: two concurrent first-reads on 1 January
 * conflict on it instead of writing two Pools.
 */
export const leavePools = pgTable(
  'leave_pools',
  {
    tenantId: tenantIdColumn(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    type: leaveTypeEnum('type').notNull(),
    leaveYear: integer('leave_year').notNull(),
    /** Days granted, one decimal — NOT an integer. Back-solving a Pool from a
     *  Remaining figure when half days have been taken produces halves, and an
     *  integer column would silently round someone's leave away. */
    days: numeric('days', { precision: 4, scale: 1 }).notNull(),
    /** How much of `days` came from last year. Stored, not recomputed on read:
     *  an admin's adjustment back-solves `days` from a Remaining figure, so the
     *  Pool deliberately stops equalling Assigned + Carried and a recomputed
     *  Carried would start contradicting it. Still not a balance — nothing
     *  writes here when a request changes status. */
    carriedDays: numeric('carried_days', { precision: 4, scale: 1 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    pk: primaryKey({ columns: [table.instructorId, table.type, table.leaveYear] }),
  }),
)
