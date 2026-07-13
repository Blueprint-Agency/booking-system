/**
 * Payroll listing — every COMPLETED class + PT session + workshop with the pay
 * owed to EACH instructor involved (main or supporting). "Completed" = lifecycle
 * 'active' AND ends_at < now() (per the payroll design: a cancelled session
 * never owes pay; a future session hasn't happened yet, even if its pay is
 * pre-set at scheduling). Workshops use the min/max of their workshop_days as
 * their effective starts_at/ends_at window (a workshop has no single date).
 *
 * Pay is unioned from five sources, one row per (session, instructor) pair:
 *   - classes.instructor_pay_sgd            (main class instructor)
 *   - class_supporting_instructors.pay_sgd  (supporting class instructors)
 *   - pt_sessions.instructor_pay_sgd        (main PT instructor)
 *   - pt_session_supporting_instructors.pay_sgd (supporting PT instructors)
 *   - workshop_instructors.pay_sgd          (all workshop instructors, incl. main)
 *
 * `id` on a row is the SESSION/workshop id (not a per-instructor id) — PATCH
 * targets a (kind, id, instructor_id) triple, see updatePayrollAmount below.
 */
import { and, eq, gte, lt, lte, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  classSupportingInstructors,
  ptSessions,
  ptSessionSupportingInstructors,
  ptRequests,
  workshops,
  workshopDays,
  workshopInstructors,
  manualPayrollEntries,
} from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { BadRequestError } from '../../shared/errors'

export interface PayrollFilter {
  instructorId?: string
  classTypeId?: string
  /** Inclusive lower bound on starts_at. */
  from?: Date
  /** Inclusive upper bound on starts_at. */
  to?: Date
}

export interface PayrollRow {
  kind: 'class' | 'pt' | 'workshop' | 'manual'
  /** The session/workshop id — shared by every instructor row for that event. */
  id: string
  instructorId: string
  instructorName: string
  /** null for workshops — they aren't tied to a single class_type. */
  classTypeId: string | null
  label: string
  sessionType: '1on1' | '2on1' | null
  startsAt: Date
  endsAt: Date
  /** numeric(10,2) — postgres returns it as a string; null when unpriced. */
  instructorPaySgd: string | null
}

export async function listPayroll(filter: PayrollFilter): Promise<PayrollRow[]> {
  const now = new Date()

  // -- main class pay --------------------------------------------------------
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

  // -- supporting class pay ---------------------------------------------------
  const classSupportingConds = [eq(classes.lifecycle, 'active'), lt(classes.endsAt, now)]
  if (filter.instructorId)
    classSupportingConds.push(eq(classSupportingInstructors.instructorId, filter.instructorId))
  if (filter.classTypeId) classSupportingConds.push(eq(classes.classTypeId, filter.classTypeId))
  if (filter.from) classSupportingConds.push(gte(classes.startsAt, filter.from))
  if (filter.to) classSupportingConds.push(lte(classes.startsAt, filter.to))

  const classSupportingRows = await db
    .select({
      id: classes.id,
      instructorId: classSupportingInstructors.instructorId,
      instructorName: staffUsers.name,
      classTypeId: classes.classTypeId,
      label: classTypes.name,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      instructorPaySgd: classSupportingInstructors.paySgd,
    })
    .from(classSupportingInstructors)
    .innerJoin(classes, eq(classes.id, classSupportingInstructors.classId))
    .innerJoin(staffUsers, eq(staffUsers.id, classSupportingInstructors.instructorId))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .where(and(...classSupportingConds))

  // -- main PT pay --------------------------------------------------------
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

  // -- supporting PT pay ----------------------------------------------------
  const ptSupportingConds = [eq(ptSessions.lifecycle, 'active'), lt(ptSessions.endsAt, now)]
  if (filter.instructorId)
    ptSupportingConds.push(eq(ptSessionSupportingInstructors.instructorId, filter.instructorId))
  if (filter.classTypeId) ptSupportingConds.push(eq(ptRequests.classTypeId, filter.classTypeId))
  if (filter.from) ptSupportingConds.push(gte(ptSessions.startsAt, filter.from))
  if (filter.to) ptSupportingConds.push(lte(ptSessions.startsAt, filter.to))

  const ptSupportingRows = await db
    .select({
      id: ptSessions.id,
      instructorId: ptSessionSupportingInstructors.instructorId,
      instructorName: staffUsers.name,
      classTypeId: ptRequests.classTypeId,
      label: classTypes.name,
      sessionType: ptSessions.sessionType,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      instructorPaySgd: ptSessionSupportingInstructors.paySgd,
    })
    .from(ptSessionSupportingInstructors)
    .innerJoin(ptSessions, eq(ptSessions.id, ptSessionSupportingInstructors.ptSessionId))
    .innerJoin(staffUsers, eq(staffUsers.id, ptSessionSupportingInstructors.instructorId))
    .innerJoin(ptRequests, eq(ptRequests.id, ptSessions.ptRequestId))
    .innerJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .where(and(...ptSupportingConds))

  // -- workshop pay (NEW payroll source) --------------------------------------
  // Workshops have no single starts_at/ends_at — min/max over workshop_days
  // stands in for "when it happened". class_type_id doesn't apply to workshops,
  // so a class_type_id filter simply excludes them (nothing to skip further).
  let workshopRows: {
    id: string
    instructorId: string
    instructorName: string
    label: string
    instructorPaySgd: string | null
    startsAt: Date
    endsAt: Date
  }[] = []
  if (!filter.classTypeId) {
    const workshopConds = [eq(workshops.lifecycle, 'active')]
    if (filter.instructorId) workshopConds.push(eq(workshopInstructors.instructorId, filter.instructorId))

    // Bare JS Dates can't be serialized inside a raw sql`` fragment (unlike the
    // typed lt()/gte() helpers the other arms use), so pass ISO strings — Postgres
    // coerces them to the timestamp of the aggregate they're compared against.
    const havingParts = [sql`max(${workshopDays.endsAt}) < ${now.toISOString()}`]
    if (filter.from) havingParts.push(sql`min(${workshopDays.startsAt}) >= ${filter.from.toISOString()}`)
    if (filter.to) havingParts.push(sql`min(${workshopDays.startsAt}) <= ${filter.to.toISOString()}`)

    workshopRows = await db
      .select({
        id: workshopInstructors.workshopId,
        instructorId: workshopInstructors.instructorId,
        instructorName: staffUsers.name,
        label: workshops.name,
        instructorPaySgd: workshopInstructors.paySgd,
        startsAt: sql<Date>`min(${workshopDays.startsAt})`,
        endsAt: sql<Date>`max(${workshopDays.endsAt})`,
      })
      .from(workshopInstructors)
      .innerJoin(workshops, eq(workshops.id, workshopInstructors.workshopId))
      .innerJoin(staffUsers, eq(staffUsers.id, workshopInstructors.instructorId))
      .innerJoin(workshopDays, eq(workshopDays.workshopId, workshops.id))
      .where(and(...workshopConds))
      .groupBy(
        workshopInstructors.workshopId,
        workshopInstructors.instructorId,
        staffUsers.name,
        workshops.name,
        workshopInstructors.paySgd,
      )
      .having(sql.join(havingParts, sql` AND `))
  }

  // -- manual payroll entries (NEW payroll source) ----------------------------
  // Ad-hoc bonus/adjustment/one-off lines, not tied to a class/PT/workshop —
  // like workshops, they have no class_type, so a class_type_id filter simply
  // excludes them. entry_date stands in for both starts_at and ends_at.
  let manualRows: {
    id: string
    instructorId: string
    instructorName: string
    label: string
    instructorPaySgd: string | null
    startsAt: Date
    endsAt: Date
  }[] = []
  if (!filter.classTypeId) {
    const manualConds = []
    if (filter.instructorId) manualConds.push(eq(manualPayrollEntries.instructorId, filter.instructorId))
    if (filter.from) manualConds.push(gte(manualPayrollEntries.entryDate, filter.from))
    if (filter.to) manualConds.push(lte(manualPayrollEntries.entryDate, filter.to))

    manualRows = await db
      .select({
        id: manualPayrollEntries.id,
        instructorId: manualPayrollEntries.instructorId,
        instructorName: staffUsers.name,
        label: manualPayrollEntries.label,
        instructorPaySgd: manualPayrollEntries.amountSgd,
        startsAt: manualPayrollEntries.entryDate,
        endsAt: manualPayrollEntries.entryDate,
      })
      .from(manualPayrollEntries)
      .innerJoin(staffUsers, eq(staffUsers.id, manualPayrollEntries.instructorId))
      .where(manualConds.length ? and(...manualConds) : undefined)
  }

  const rows: PayrollRow[] = [
    ...classRows.map(r => ({ ...r, kind: 'class' as const, sessionType: null })),
    ...classSupportingRows.map(r => ({ ...r, kind: 'class' as const, sessionType: null })),
    ...ptRows.map(r => ({ ...r, kind: 'pt' as const })),
    ...ptSupportingRows.map(r => ({ ...r, kind: 'pt' as const })),
    ...workshopRows.map(r => ({ ...r, kind: 'workshop' as const, classTypeId: null, sessionType: null })),
    ...manualRows.map(r => ({ ...r, kind: 'manual' as const, classTypeId: null, sessionType: null })),
  ]
  rows.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
  return rows
}

export interface UpdatePayrollResult {
  ok: boolean
}

/**
 * Set (or clear, when amount is null) the pay for one (session, instructor) pair.
 *
 * `instructorId` omitted → back-compat: writes the session's own pay column
 * (classes.instructor_pay_sgd / pt_sessions.instructor_pay_sgd), exactly as
 * before this row could carry more than one instructor's pay. Not valid for
 * kind='workshop' (workshops have no single default-pay column — instructorId
 * is required).
 *
 * `instructorId` present → resolves to the specific row: the parent session's
 * own column when it matches the session's main instructor, otherwise the
 * matching supporting-instructor join row.
 */
export async function updatePayrollAmount(
  kind: 'class' | 'pt' | 'workshop' | 'manual',
  id: string,
  amount: number | null,
  instructorId?: string,
): Promise<UpdatePayrollResult> {
  const value = amount == null ? null : amount.toFixed(2)

  if (kind === 'manual') {
    if (value == null) throw new BadRequestError('manual_amount_required')
    const rows = await db
      .update(manualPayrollEntries)
      .set({ amountSgd: value })
      .where(eq(manualPayrollEntries.id, id))
      .returning({ id: manualPayrollEntries.id })
    return { ok: rows.length > 0 }
  }

  if (kind === 'workshop') {
    if (!instructorId) throw new BadRequestError('instructor_id_required')
    const rows = await db
      .update(workshopInstructors)
      .set({ paySgd: value })
      .where(
        and(eq(workshopInstructors.workshopId, id), eq(workshopInstructors.instructorId, instructorId)),
      )
      .returning({ workshopId: workshopInstructors.workshopId })
    return { ok: rows.length > 0 }
  }

  if (kind === 'class') {
    if (instructorId) {
      const [row] = await db
        .select({ mainInstructorId: classes.mainInstructorId })
        .from(classes)
        .where(eq(classes.id, id))
        .limit(1)
      if (!row) return { ok: false }
      if (row.mainInstructorId !== instructorId) {
        const rows = await db
          .update(classSupportingInstructors)
          .set({ paySgd: value })
          .where(
            and(
              eq(classSupportingInstructors.classId, id),
              eq(classSupportingInstructors.instructorId, instructorId),
            ),
          )
          .returning({ classId: classSupportingInstructors.classId })
        return { ok: rows.length > 0 }
      }
    }
    const rows = await db
      .update(classes)
      .set({ instructorPaySgd: value })
      .where(eq(classes.id, id))
      .returning({ id: classes.id })
    return { ok: rows.length > 0 }
  }

  // kind === 'pt'
  if (instructorId) {
    const [row] = await db
      .select({ instructorId: ptSessions.instructorId })
      .from(ptSessions)
      .where(eq(ptSessions.id, id))
      .limit(1)
    if (!row) return { ok: false }
    if (row.instructorId !== instructorId) {
      const rows = await db
        .update(ptSessionSupportingInstructors)
        .set({ paySgd: value })
        .where(
          and(
            eq(ptSessionSupportingInstructors.ptSessionId, id),
            eq(ptSessionSupportingInstructors.instructorId, instructorId),
          ),
        )
        .returning({ ptSessionId: ptSessionSupportingInstructors.ptSessionId })
      return { ok: rows.length > 0 }
    }
  }
  const rows = await db
    .update(ptSessions)
    .set({ instructorPaySgd: value })
    .where(eq(ptSessions.id, id))
    .returning({ id: ptSessions.id })
  return { ok: rows.length > 0 }
}

export interface CreateManualPayrollInput {
  instructorId: string
  amountSgd: number
  label: string
  entryDate: Date
}

/** Ad-hoc pay line for an instructor — bonus/adjustment/one-off not tied to a session. */
export async function createManualPayroll(input: CreateManualPayrollInput, actorStaffId: string) {
  const rows = await db
    .insert(manualPayrollEntries)
    .values({
      instructorId: input.instructorId,
      amountSgd: input.amountSgd.toFixed(2),
      label: input.label,
      entryDate: input.entryDate,
      createdByStaffId: actorStaffId,
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error('insert returned no rows')
  return row
}

export async function deleteManualPayroll(id: string): Promise<UpdatePayrollResult> {
  const rows = await db
    .delete(manualPayrollEntries)
    .where(eq(manualPayrollEntries.id, id))
    .returning({ id: manualPayrollEntries.id })
  return { ok: rows.length > 0 }
}
