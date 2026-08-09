/**
 * Why a payroll save didn't happen: the reason, the HTTP status it deserves,
 * and the sentence an admin reads.
 *
 * Why it exists: `updatePayrollAmount` used to answer `{ ok: boolean }` and the
 * route turned every falsy answer into a bare 404. Six distinct failures reached
 * the admin as one message — the session was cancelled or deleted, the manual
 * entry was deleted, the instructor was taken off the session, no instructor was
 * named for a workshop (which pays each instructor separately), a manual entry
 * was cleared to no amount, or the amount was negative. "Not found" is a lie for
 * four of those, and the admin could not tell which thing to fix.
 *
 * Pure on purpose — no db import — so the status table and the wording can be
 * checked without a database (`save-reasons.test.ts`), and the routes can map a
 * reason without pulling the payroll queries in.
 *
 * What is deliberately NOT unified: this is payroll's own reason set, not a
 * shared refusal vocabulary. Schedule writes refuse by THROWING (`AppError` +
 * a code, see services/schedule/occupancy.ts) because they fail deep inside a
 * transaction that has to unwind; a payroll save is one statement and hands its
 * refusal back as a value. Merging the two would force one of them to lie about
 * how it fails. What they DO share is the wire shape — `{ error, message }`,
 * same as the error boundary emits — so the portal reads both the same way.
 */
import type { PayrollKind } from './list'

export type PayrollSaveReason =
  /** The class / PT session / workshop / manual entry itself is gone. */
  | 'record_not_found'
  /** The record exists, but that instructor is not on its roster. */
  | 'instructor_not_assigned'
  /** Negative, non-finite, or cleared when the row can't be unpriced. */
  | 'invalid_amount'
  /** A workshop pays each instructor separately — one must be named. */
  | 'instructor_required'

export type PayrollSaveResult = { ok: true } | { ok: false; reason: PayrollSaveReason }

/** Shorthand for the failure arm — the callers below are all one-liners. */
export const payrollSaveFailed = (reason: PayrollSaveReason): PayrollSaveResult => ({
  ok: false,
  reason,
})

/**
 * Reason → status. The route reads this table; it never infers a status from
 * the shape of the answer. 409 (not 404) for an unassigned instructor: the
 * record is there, the admin's copy of who is on it is stale.
 */
export const payrollSaveStatus: Record<PayrollSaveReason, 400 | 404 | 409> = {
  record_not_found: 404,
  instructor_not_assigned: 409,
  invalid_amount: 400,
  instructor_required: 400,
}

const KIND_LABEL: Record<PayrollKind, string> = {
  class: 'class',
  pt: 'private session',
  workshop: 'workshop',
  manual: 'payroll entry',
}

/**
 * The sentence the portal shows. Composed here because only the backend knows
 * WHICH kind of record failed — the portal prefers this over its own copy table,
 * exactly as it does for a schedule conflict.
 */
export function payrollSaveMessage(reason: PayrollSaveReason, kind: PayrollKind): string {
  const label = KIND_LABEL[kind]
  switch (reason) {
    case 'record_not_found':
      return `That ${label} no longer exists — it was deleted or cancelled. Reload the payroll list.`
    case 'instructor_not_assigned':
      return `That instructor is no longer on this ${label}, so there is no pay to set. Reload the payroll list.`
    case 'invalid_amount':
      return kind === 'manual'
        ? 'A manual payroll entry must have an amount — it cannot be cleared. Delete the entry instead.'
        : 'Enter an amount of zero or more, or clear the field to unset the pay.'
    case 'instructor_required':
      return `A ${label} pays each instructor separately — pick whose pay to change.`
  }
}
