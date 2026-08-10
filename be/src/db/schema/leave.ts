import { pgTable, uuid, text, date, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { staffUsers } from './identity'
import { instructors } from './catalog'
import { leaveTypeEnum, leaveStatusEnum, leaveHalfDayEnum } from '../enums'

/**
 * Instructor leave requests — see docs/md/spec-instructor-leave.md.
 *
 * There is deliberately NO balance counter anywhere. Remaining days are derived
 * by summing `days` over this table (see services/leave/rules.ts), so cancelling
 * restores days for free and a new year resets itself with no job.
 *
 * `leaveYear` is stored rather than derived at read time so that changing an
 * allowance, or crossing a year boundary, cannot alter what a past request
 * counted against.
 *
 * Dates are plain `date` — Asia/Singapore calendar days, not instants.
 */
export const leaveRequests = pgTable(
  'leave_requests',
  {
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
    /** Private-bucket object key for a medical certificate (upload lands later). */
    medicalCertR2Key: text('medical_cert_r2_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    // The balance query: one instructor's rows for one leave year.
    balanceIdx: index('leave_requests_instructor_year_idx').on(table.instructorId, table.leaveYear),
    // The calendar / clash queries: everything overlapping a date window.
    datesIdx: index('leave_requests_dates_idx').on(table.startDate, table.endDate),
    statusIdx: index('leave_requests_status_idx').on(table.status),
  }),
)
