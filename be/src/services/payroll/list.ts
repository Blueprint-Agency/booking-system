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
 * Corporate sessions are absent on purpose: neither corporate table has a pay
 * column, so there is nothing for payroll to list or price.
 *
 * Payroll READS those five sources directly (it needs the joins, the completed
 * window and the filters); it WRITES none of them — a pay edit is a roster write
 * and goes through services/schedule/roster.
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
import { readRoster, readRosters, setInstructorPay, type RosterEventKind } from '../schedule/roster'
import { summarizePayroll, type PayrollSummary } from './totals'
import { payrollSaveFailed, type PayrollSaveResult } from './save-reasons'

export type { PayrollSaveReason, PayrollSaveResult } from './save-reasons'

export type PayrollKind = 'class' | 'pt' | 'workshop' | 'manual'

/**
 * Which table a payroll row of each kind is written to — the audit target for a
 * pay edit. Lives next to updatePayrollAmount because that's the only code that
 * knows it; routes must not re-derive it. ('class'/'pt' name the parent session
 * table even when the write lands on the supporting-instructor join row — the
 * session is the record being repriced.)
 */
export const payrollAuditTable: Record<PayrollKind, string> = {
  class: 'classes',
  pt: 'pt_sessions',
  workshop: 'workshop_instructors',
  manual: 'manual_payroll_entries',
}

export interface PayrollFilter {
  instructorId?: string
  classTypeId?: string
  /** Inclusive lower bound on starts_at. */
  from?: Date
  /** Inclusive upper bound on starts_at. */
  to?: Date
}

export interface PayrollRow {
  kind: PayrollKind
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

/**
 * The query half — unordered rows straight out of the five sources. Internal on
 * purpose: callers go through getPayroll so ordering and totalling can't drift.
 */
async function listPayroll(filter: PayrollFilter): Promise<PayrollRow[]> {
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
  return rows
}

/**
 * The one payroll read. Admin passes whatever filter the screen has; an
 * instructor's own log is this same call with instructorId forced to them —
 * not a second implementation. Returns serialized rows plus every total either
 * screen needs; each route picks the fields its response shape has.
 */
export async function getPayroll(filter: PayrollFilter): Promise<PayrollSummary> {
  return summarizePayroll(await listPayroll(filter))
}

/** Payroll's kind → the roster module's. Payroll has no corporate rows (corporate
 *  sessions carry no pay columns), and 'manual' isn't an event at all. */
const rosterKind: Record<Exclude<PayrollKind, 'manual'>, RosterEventKind> = {
  class: 'class',
  pt: 'pt_session',
  workshop: 'workshop',
}

/**
 * Set (or clear, when amount is null) the pay for one (session, instructor) pair.
 * A failure comes back as a reason, never a bare false — see ./save-reasons.ts
 * for why, and for which status each reason earns.
 *
 * Everything except a manual entry is a roster write, so it goes through
 * `setInstructorPay` — which storage shape holds the pay (event column vs join
 * row vs a workshop's role='main' row) is the roster module's business, not
 * payroll's.
 *
 * `instructorId` omitted → back-compat: prices the event's MAIN instructor, which
 * is what "the session's own pay column" always meant. Not valid for
 * kind='workshop' (no single default-pay column there).
 */
export async function updatePayrollAmount(
  kind: PayrollKind,
  id: string,
  amount: number | null,
  instructorId?: string,
): Promise<PayrollSaveResult> {
  // The route's zod schema says the same thing, but this is the trust boundary
  // for every other caller — a NaN reaching toFixed() writes garbage money.
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
    return payrollSaveFailed('invalid_amount')
  }

  if (kind === 'manual') {
    // A manual line IS its amount; clearing it would leave a labelled ghost.
    if (amount == null) return payrollSaveFailed('invalid_amount')
    const rows = await db
      .update(manualPayrollEntries)
      .set({ amountSgd: amount.toFixed(2) })
      .where(eq(manualPayrollEntries.id, id))
      .returning({ id: manualPayrollEntries.id })
    return rows.length > 0 ? { ok: true } : payrollSaveFailed('record_not_found')
  }

  if (kind === 'workshop' && !instructorId) return payrollSaveFailed('instructor_required')

  const ref = { kind: rosterKind[kind], id }
  // No main to fall back on means the event row itself is gone: classes and PT
  // sessions keep their main instructor ON the row, so a roster without one is a
  // roster with no event behind it (workshops, whose main is just another row,
  // were required to name an instructor above).
  const target = instructorId ?? (await readRoster(ref)).find(r => r.role === 'main')?.instructorId
  if (!target) return payrollSaveFailed('record_not_found')

  if (await setInstructorPay(ref, target, amount)) return { ok: true }

  // `setInstructorPay` answers false for two different situations — no event, or
  // an event this instructor isn't on. Only the failing path pays for the extra
  // read that tells them apart; `readRosters` keys events it FOUND, so a missing
  // key is a missing event (an empty roster is a real state for a workshop).
  const exists = (await readRosters(ref.kind, [ref.id])).has(ref.id)
  return payrollSaveFailed(exists ? 'instructor_not_assigned' : 'record_not_found')
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

export async function deleteManualPayroll(id: string): Promise<PayrollSaveResult> {
  const rows = await db
    .delete(manualPayrollEntries)
    .where(eq(manualPayrollEntries.id, id))
    .returning({ id: manualPayrollEntries.id })
  return rows.length > 0 ? { ok: true } : payrollSaveFailed('record_not_found')
}
