/**
 * Instructor leave — the rules, as pure functions.
 *
 * Kept decidable without a database, an env or a clock (see rules.test.ts) — the
 * one import is `lib/time`, which is the same kind of thing: pure arithmetic.
 * `requests.ts` is the only thing that queries; the queries NARROW candidates
 * and these functions decide.
 *
 * Two things to keep in mind while reading:
 *
 *  - **The balance is derived, never stored.** Remaining = allowance minus the
 *    days on that instructor's requests of that type and leave year. Cancelling
 *    therefore restores days with no code at all — the row simply leaves the
 *    counted set — and January resets itself with no scheduled job.
 *  - **Dates here are plain dates**, `YYYY-MM-DD`, read as Asia/Singapore
 *    calendar days (UTC+8, no DST). They are not instants. The only place an
 *    instant appears is `leaveWindow`, which turns a run of days into the
 *    [start, end) window the occupancy module compares against.
 */

import { daysBetween, sgDayWindow, sgToday, type PlainDate } from '../../lib/time'

/** Singapore-time arithmetic lives in `lib/time`; re-exported so the leave rules
 *  still read as one vocabulary. */
export { daysBetween, sgToday, type PlainDate }

export type LeaveType = 'annual' | 'medical'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled' | 'revoked'
/** Which half of the day, if it is a half day at all. */
export type LeaveHalfDay = 'none' | 'morning' | 'afternoon'

/** Morning ends and afternoon begins at 13:00 Singapore time. */
export const HALF_DAY_BOUNDARY_HOUR = 13

/**
 * Days a request consumes: one per calendar date, INCLUSIVE of both ends. There
 * is no working-pattern or public-holiday data in this system, so a Sunday
 * inside a range still costs a day — an instructor who wants to skip it files
 * two requests.
 *
 * A half day costs 0.5, and is only ever a single date — `checkLeaveSubmission`
 * refuses the marker on a range before it can be counted.
 */
export function countLeaveDays(
  startDate: PlainDate,
  endDate: PlainDate,
  halfDay: LeaveHalfDay = 'none',
): number {
  const days = daysBetween(startDate, endDate) + 1
  return halfDay === 'none' || days !== 1 ? days : 0.5
}

/** The leave year a request counts against: the year it starts in. A range that
 *  crosses new year counts wholly against the year it began. */
export function leaveYearOf(startDate: PlainDate): number {
  return Number(startDate.slice(0, 4))
}

/**
 * The run of days as a half-open instant window in Singapore time — start of
 * the first day up to start of the day AFTER the last. This is what gets handed
 * to the occupancy module, so it must not bleed into the adjacent day.
 *
 * A half day trims that window at 13:00 Singapore time: morning is [day start,
 * 13:00), afternoon is [13:00, day end). Because the window is half-open and
 * the overlap rule ignores touching endpoints, a 12:00–13:00 event is morning
 * only, a 13:00–14:00 event is afternoon only, and anything crossing 13:00
 * overlaps BOTH halves — which is exactly the intended rule.
 *
 * A half-day marker is only valid on a single date; a range keeps its first
 * day's boundary, which is moot because `checkLeaveSubmission` refuses it.
 */
export function leaveWindow(
  startDate: PlainDate,
  endDate: PlainDate,
  halfDay: LeaveHalfDay = 'none',
): { startsAt: Date; endsAt: Date } {
  const { startsAt, endsAt } = sgDayWindow(startDate, endDate)
  const boundary = new Date(startsAt.getTime() + HALF_DAY_BOUNDARY_HOUR * 3_600_000)
  return {
    startsAt: halfDay === 'afternoon' ? boundary : startsAt,
    endsAt: halfDay === 'morning' ? boundary : endsAt,
  }
}

/**
 * Does leave of this shape take the instructor off a class that STARTS at this
 * wall-clock time? `startTime` is `HH:MM` on the leave date read as Singapore
 * time — exactly what the scheduling forms hold in their time input.
 *
 * This is the instructor PICKER's question, not the server's. Two consequences,
 * both deliberate, both in the direction of "let it through and let the save
 * decide":
 *
 *  - **No time known, no refusal.** A screen that has only a date passes
 *    nothing, and a half day comes back `false`: the instructor is labelled with
 *    the half and stays selectable.
 *  - **Only the start is read.** A class straddling the boundary counts as the
 *    half it begins in, where `leaveWindow` overlaps BOTH halves and the server
 *    refuses it. So the picker can be laxer than the save — never stricter,
 *    which would hide a slot the server would have taken.
 */
export function leaveCoversStart(halfDay: LeaveHalfDay, startTime?: string): boolean {
  if (halfDay === 'none') return true
  // The boundary is a whole hour, so the hour alone decides it.
  const hour = Number(/^(\d{1,2}):/.exec(startTime ?? '')?.[1])
  if (!Number.isInteger(hour)) return false
  return halfDay === (hour < HALF_DAY_BOUNDARY_HOUR ? 'morning' : 'afternoon')
}

// ── Balance ────────────────────────────────────────────────────────────────

/** What a row contributes to a balance. Nothing else about it matters here. */
export interface LeaveDaysRow {
  type: LeaveType
  leaveYear: number
  status: LeaveStatus
  days: number
}

/**
 * Leave that takes an instructor off the schedule (see schedule/occupancy.ts).
 * Pending counts as well as approved, so a request cannot become impossible to
 * approve because someone was scheduled in the gap before the decision.
 *
 * Deliberately not COMMITTED_STATUSES: that one is about a balance, this one is
 * about a calendar, and they are free to diverge.
 */
export const OCCUPYING_STATUSES: readonly LeaveStatus[] = ['approved', 'pending']

/** What has actually been taken — the number an instructor sees as "used". */
export const TAKEN_STATUSES: readonly LeaveStatus[] = ['approved']
/** What a NEW submission is measured against. Pending counts too: that is what
 *  stops two simultaneous requests from together exceeding the allowance. */
export const COMMITTED_STATUSES: readonly LeaveStatus[] = ['approved', 'pending']

export interface BalanceScope {
  type: LeaveType
  leaveYear: number
  statuses: readonly LeaveStatus[]
}

/** Days are 0.5-grained; sum in halves so 0.5 + 0.5 + 0.5 is exactly 1.5. */
export function sumLeaveDays(rows: readonly LeaveDaysRow[], scope: BalanceScope): number {
  let halves = 0
  for (const r of rows) {
    if (r.type !== scope.type) continue
    if (r.leaveYear !== scope.leaveYear) continue
    if (!scope.statuses.includes(r.status)) continue
    halves += Math.round(r.days * 2)
  }
  return halves / 2
}

/** Allowance minus what the scope counts. Not clamped: a lowered allowance can
 *  legitimately leave someone negative, and hiding that would be a lie. */
export function remainingLeaveDays(
  allowance: number,
  rows: readonly LeaveDaysRow[],
  scope: BalanceScope,
): number {
  return allowance - sumLeaveDays(rows, scope)
}

// ── Submission ─────────────────────────────────────────────────────────────

/** How far back a medical request may reach. Annual may not reach back at all. */
export const MEDICAL_BACKDATE_DAYS = 7

export type LeaveRefusalCode =
  | 'invalid_date_range'
  | 'half_day_requires_single_date'
  | 'annual_leave_must_start_in_future'
  | 'medical_leave_backdated_too_far'
  | 'insufficient_leave_balance'

export interface LeaveSubmission {
  type: LeaveType
  startDate: PlainDate
  endDate: PlainDate
  /** Single-date requests only; a range must be full days. */
  halfDay?: LeaveHalfDay
  /** Today in Singapore. */
  today: PlainDate
  /** The global yearly allowance for this type. */
  allowance: number
  /** This instructor's approved + pending days for this type and leave year. */
  committedDays: number
}

export type LeaveCheck =
  | { ok: true; days: number; leaveYear: number }
  | { ok: false; code: LeaveRefusalCode; message: string }

const plural = (n: number) => (n === 1 ? 'day' : 'days')

/**
 * Everything about a submission that can be decided without touching the
 * database: the range makes sense, the dates are filable, and the days fit in
 * what is left. The remaining rule — no clash with a future assignment — needs
 * the schedule and lives in `requests.ts`.
 */
export function checkLeaveSubmission(input: LeaveSubmission): LeaveCheck {
  const halfDay = input.halfDay ?? 'none'
  const dates = countLeaveDays(input.startDate, input.endDate)
  if (dates < 1) {
    return { ok: false, code: 'invalid_date_range', message: 'End date must be on or after the start date.' }
  }
  if (halfDay !== 'none' && dates !== 1) {
    return {
      ok: false,
      code: 'half_day_requires_single_date',
      message:
        'A half day has to be a single date. Use the same first and last day, ' +
        'or request full days and file the half day separately.',
    }
  }
  const days = countLeaveDays(input.startDate, input.endDate, halfDay)

  const startOffset = daysBetween(input.today, input.startDate)
  if (input.type === 'annual' && startOffset < 1) {
    return {
      ok: false,
      code: 'annual_leave_must_start_in_future',
      message: 'Annual leave must start after today. Pick a later start date.',
    }
  }
  if (input.type === 'medical' && startOffset < -MEDICAL_BACKDATE_DAYS) {
    return {
      ok: false,
      code: 'medical_leave_backdated_too_far',
      message: `Medical leave can be backdated by at most ${MEDICAL_BACKDATE_DAYS} days.`,
    }
  }

  const remaining = input.allowance - input.committedDays
  if (days > remaining) {
    return {
      ok: false,
      code: 'insufficient_leave_balance',
      message:
        `That request is ${days} ${plural(days)}, but you have ${remaining} of your ` +
        `${input.allowance} ${input.type} ${plural(input.allowance)} left this year ` +
        `(approved and pending requests both count).`,
    }
  }

  return { ok: true, days, leaveYear: leaveYearOf(input.startDate) }
}

/**
 * Only a conflict that ENDS in the future blocks a submission. That is what
 * makes backdated medical leave filable: it records the absence without being
 * obstructed by — or disturbing — classes that already happened.
 */
export function futureConflicts<T extends { ends_at: string }>(
  conflicts: readonly T[],
  now: Date,
): T[] {
  return conflicts.filter(c => Date.parse(c.ends_at) > now.getTime())
}

// ── Medical certificate ────────────────────────────────────────────────────

/** 5MB. Refused before a single byte reaches storage. */
export const MEDICAL_CERT_MAX_BYTES = 5 * 1024 * 1024

/** The only three things a certificate may be, and the extension each is kept as. */
export const MEDICAL_CERT_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export type MedicalCertRefusalCode =
  | 'certificate_not_medical_leave'
  | 'certificate_type_not_allowed'
  | 'certificate_empty'
  | 'certificate_too_large'

export type MedicalCertCheck =
  | { ok: true; extension: string }
  | { ok: false; code: MedicalCertRefusalCode; message: string }

/**
 * Whether this upload may be attached at all — the whole of the file rule, and
 * therefore the whole of what the route has to trust. The browser's `accept`
 * attribute is a convenience; this is the check.
 *
 * The content type is what the client declared, which is why the object is put
 * in a bucket nothing can read without a signed URL: a mislabelled file is then
 * only ever shown back to the two people already allowed to see it.
 */
export function checkMedicalCertificate(input: {
  leaveType: LeaveType
  contentType: string
  size: number
}): MedicalCertCheck {
  if (input.leaveType !== 'medical') {
    return {
      ok: false,
      code: 'certificate_not_medical_leave',
      message: 'Only a medical leave request takes a certificate.',
    }
  }
  // `image/png; charset=binary` is still image/png.
  const extension = MEDICAL_CERT_TYPES[(input.contentType.split(';')[0] ?? '').trim().toLowerCase()]
  if (!extension) {
    return {
      ok: false,
      code: 'certificate_type_not_allowed',
      message: 'A certificate has to be a JPG, PNG or PDF.',
    }
  }
  if (input.size < 1) {
    return { ok: false, code: 'certificate_empty', message: 'That file is empty.' }
  }
  if (input.size > MEDICAL_CERT_MAX_BYTES) {
    return {
      ok: false,
      code: 'certificate_too_large',
      message: `A certificate can be at most ${MEDICAL_CERT_MAX_BYTES / (1024 * 1024)}MB.`,
    }
  }
  return { ok: true, extension }
}

/** Where the object lives. Deterministic, so re-uploading replaces rather than
 *  orphans — and guessable on purpose is fine: the bucket is private. */
export function medicalCertKey(
  instructorId: string,
  requestId: string,
  extension: string,
): string {
  return `medical-certificates/${instructorId}/${requestId}.${extension}`
}

// ── The instructor's own transitions ───────────────────────────────────────

/**
 * Withdraw abandons a request still awaiting a decision; cancel gives back
 * leave that was approved but has not started yet. Both return the days to the
 * balance automatically, because the balance is a sum over approved rows.
 */
export function checkOwnLeaveTransition(
  action: 'withdraw' | 'cancel',
  row: { status: LeaveStatus; startDate: PlainDate },
  today: PlainDate,
): { ok: true; status: 'withdrawn' | 'cancelled' } | { ok: false; code: string; message: string } {
  if (action === 'withdraw') {
    if (row.status !== 'pending') {
      return {
        ok: false,
        code: 'leave_not_pending',
        message: 'Only a request that is still pending can be withdrawn.',
      }
    }
    return { ok: true, status: 'withdrawn' }
  }
  if (row.status !== 'approved') {
    return {
      ok: false,
      code: 'leave_not_approved',
      message: 'Only approved leave can be cancelled.',
    }
  }
  if (daysBetween(today, row.startDate) < 1) {
    return {
      ok: false,
      code: 'leave_already_started',
      message: 'Leave that has already started cannot be cancelled. Ask an admin.',
    }
  }
  return { ok: true, status: 'cancelled' }
}

// ── The admin's decisions ──────────────────────────────────────────────────

export type AdminLeaveAction = 'approve' | 'reject' | 'revoke'

const DECIDED = { approve: 'approved', reject: 'rejected' } as const

/**
 * What an admin or superadmin may do to a request, and when.
 *
 * Approve and reject settle a request that is still awaiting a decision, and
 * nothing else — a request that was already decided, withdrawn or cancelled is
 * finished. Revoke takes back leave that was approved but has NOT started; once
 * the first day arrives the absence has happened, so nobody — admin included —
 * can undo it.
 *
 * None of these need balance bookkeeping. The balance is a sum over approved
 * rows, so a rejected or revoked row simply stops counting.
 */
export function checkAdminLeaveDecision(
  action: AdminLeaveAction,
  row: { status: LeaveStatus; startDate: PlainDate },
  today: PlainDate,
):
  | { ok: true; status: 'approved' | 'rejected' | 'revoked' }
  | { ok: false; code: string; message: string } {
  if (action === 'revoke') {
    if (row.status !== 'approved') {
      return {
        ok: false,
        code: 'leave_not_approved',
        message: 'Only approved leave can be revoked.',
      }
    }
    if (daysBetween(today, row.startDate) < 1) {
      return {
        ok: false,
        code: 'leave_already_started',
        message: 'This leave has already started. Leave in the past cannot be revoked.',
      }
    }
    return { ok: true, status: 'revoked' }
  }
  if (row.status !== 'pending') {
    return {
      ok: false,
      code: 'leave_not_pending',
      message: `This request is already ${row.status}. Only a pending request can be ${DECIDED[action]}.`,
    }
  }
  return { ok: true, status: DECIDED[action] }
}
