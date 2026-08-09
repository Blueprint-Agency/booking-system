/**
 * Payroll grouping + totalling — pure, no DB, no HTTP.
 *
 * Both payroll screens (admin's all-instructors table and an instructor's own
 * teaching log) get their figures from this one function, so they can never
 * disagree for the same instructor and period. The routes only pick which of
 * these fields to return; they do no arithmetic of their own.
 *
 * Rules encoded here:
 *   - only priced rows contribute to a total; unpriced ones are counted separately
 *     (an unpriced assignment is "pay not decided yet", not "pay of zero");
 *   - manual entries are ordinary priced rows and count like any other;
 *   - duration is derived from the row's window, never stored;
 *   - rows are newest-first; per-instructor totals are by instructor name.
 */
import type { PayrollRow } from './list'

/** A payroll row as both endpoints serialize it (snake_case, JSON-ready). */
export interface PayrollLine {
  kind: PayrollRow['kind']
  id: string
  instructor_id: string
  instructor_name: string
  class_type_id: string | null
  label: string
  session_type: '1on1' | '2on1' | null
  starts_at: string
  ends_at: string
  duration_minutes: number
  instructor_pay_sgd: number | null
}

export interface PayrollInstructorTotal {
  instructor_id: string
  instructor_name: string
  total_sgd: number
  session_count: number
}

export interface PayrollSummary {
  rows: PayrollLine[]
  /** Per-instructor breakdown, by instructor name. */
  totals: PayrollInstructorTotal[]
  /** Sum over every priced row in the set (i.e. the sum of `totals`). */
  total_sgd: number
  session_count: number
  /** Rows with no pay set — counted, but excluded from every total. */
  unpriced_count: number
}

/** Money is numeric(10,2); accumulate in cents so 0.1 + 0.2 stays 0.30. */
const toCents = (v: string | number) => Math.round(Number(v) * 100)

export function serializePayrollRow(r: PayrollRow): PayrollLine {
  return {
    kind: r.kind,
    id: r.id,
    instructor_id: r.instructorId,
    instructor_name: r.instructorName,
    class_type_id: r.classTypeId,
    label: r.label,
    session_type: r.sessionType,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    duration_minutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000),
    instructor_pay_sgd: r.instructorPaySgd == null ? null : Number(r.instructorPaySgd),
  }
}

export function summarizePayroll(rows: readonly PayrollRow[]): PayrollSummary {
  const byInstructor = new Map<string, PayrollInstructorTotal & { cents: number }>()
  let totalCents = 0
  let unpricedCount = 0

  for (const r of rows) {
    const t =
      byInstructor.get(r.instructorId) ??
      {
        instructor_id: r.instructorId,
        instructor_name: r.instructorName,
        total_sgd: 0,
        session_count: 0,
        cents: 0,
      }
    t.session_count += 1
    if (r.instructorPaySgd == null) unpricedCount += 1
    else {
      const cents = toCents(r.instructorPaySgd)
      t.cents += cents
      totalCents += cents
    }
    byInstructor.set(r.instructorId, t)
  }

  const totals = Array.from(byInstructor.values())
    .map(({ cents, ...t }) => ({ ...t, total_sgd: cents / 100 }))
    .sort((a, b) => a.instructor_name.localeCompare(b.instructor_name))

  return {
    rows: [...rows]
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .map(serializePayrollRow),
    totals,
    total_sgd: totalCents / 100,
    session_count: rows.length,
    unpriced_count: unpricedCount,
  }
}
