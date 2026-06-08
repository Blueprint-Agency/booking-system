/**
 * Payroll listing — every COMPLETED class + PT session with the pay owed to its
 * (main) instructor. "Completed" = lifecycle 'active' AND ends_at < now() (per
 * the payroll design: a cancelled session never owes pay; a future session
 * hasn't happened yet, even if its pay is pre-set at scheduling).
 *
 * Pay is stored on the session row (classes/pt_sessions.instructor_pay_sgd) and
 * is 1:1 with its main instructor, so this is a straight merge of two selects.
 * Only the main instructor is paid in v1 (supporting instructors are excluded).
 */
import { and, eq, gte, lt, lte } from 'drizzle-orm'
import { db } from '../../db'
import { classes, ptSessions, ptRequests } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'

export interface PayrollFilter {
  instructorId?: string
  classTypeId?: string
  /** Inclusive lower bound on starts_at. */
  from?: Date
  /** Inclusive upper bound on starts_at. */
  to?: Date
}

export interface PayrollRow {
  kind: 'class' | 'pt'
  id: string
  instructorId: string
  instructorName: string
  classTypeId: string
  label: string
  sessionType: '1on1' | '2on1' | null
  startsAt: Date
  endsAt: Date
  /** numeric(10,2) — postgres returns it as a string; null when unpriced. */
  instructorPaySgd: string | null
}

export async function listPayroll(filter: PayrollFilter): Promise<PayrollRow[]> {
  const now = new Date()

  const classConds = [eq(classes.lifecycle, 'active'), lt(classes.endsAt, now)]
  if (filter.instructorId) classConds.push(eq(classes.mainInstructorId, filter.instructorId))
  if (filter.classTypeId) classConds.push(eq(classes.classTypeId, filter.classTypeId))
  if (filter.from) classConds.push(gte(classes.startsAt, filter.from))
  if (filter.to) classConds.push(lte(classes.startsAt, filter.to))

  const classRows = await db
    .select({
      id: classes.id,
      instructorId: classes.mainInstructorId,
      instructorName: staffUsers.name,
      classTypeId: classes.classTypeId,
      label: classTypes.name,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      instructorPaySgd: classes.instructorPaySgd,
    })
    .from(classes)
    .innerJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .where(and(...classConds))

  const ptConds = [eq(ptSessions.lifecycle, 'active'), lt(ptSessions.endsAt, now)]
  if (filter.instructorId) ptConds.push(eq(ptSessions.instructorId, filter.instructorId))
  if (filter.classTypeId) ptConds.push(eq(ptRequests.classTypeId, filter.classTypeId))
  if (filter.from) ptConds.push(gte(ptSessions.startsAt, filter.from))
  if (filter.to) ptConds.push(lte(ptSessions.startsAt, filter.to))

  const ptRows = await db
    .select({
      id: ptSessions.id,
      instructorId: ptSessions.instructorId,
      instructorName: staffUsers.name,
      classTypeId: ptRequests.classTypeId,
      label: classTypes.name,
      sessionType: ptSessions.sessionType,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      instructorPaySgd: ptSessions.instructorPaySgd,
    })
    .from(ptSessions)
    .innerJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .innerJoin(ptRequests, eq(ptRequests.id, ptSessions.ptRequestId))
    .innerJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .where(and(...ptConds))

  const rows: PayrollRow[] = [
    ...classRows.map(r => ({ ...r, kind: 'class' as const, sessionType: null })),
    ...ptRows.map(r => ({ ...r, kind: 'pt' as const })),
  ]
  rows.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
  return rows
}

export interface UpdatePayrollResult {
  ok: boolean
}

/** Set (or clear, when amount is null) the pay on a single class / pt session. */
export async function updatePayrollAmount(
  kind: 'class' | 'pt',
  id: string,
  amount: number | null,
): Promise<UpdatePayrollResult> {
  const value = amount == null ? null : amount.toFixed(2)
  if (kind === 'class') {
    const rows = await db
      .update(classes)
      .set({ instructorPaySgd: value })
      .where(eq(classes.id, id))
      .returning({ id: classes.id })
    return { ok: rows.length > 0 }
  }
  const rows = await db
    .update(ptSessions)
    .set({ instructorPaySgd: value })
    .where(eq(ptSessions.id, id))
    .returning({ id: ptSessions.id })
  return { ok: rows.length > 0 }
}
