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
 *  - **The Pool is a stored grant; everything drawn from it is derived.** The
 *    Pool for one instructor, Leave Type and Leave Year is a row (carry-over
 *    forces that — see docs/adr/0001). Taken and Committed are still summed from
 *    the requests themselves, so Remaining = Pool − Committed and withdrawing,
 *    cancelling, rejecting or revoking returns the days with no code at all: the
 *    row simply leaves the counted set. Nothing is ever written back when a
 *    request changes status, and a column holding Taken or Remaining would give
 *    that property up.
 *  - **Dates here are plain dates**, `YYYY-MM-DD`, read as Asia/Singapore
 *    calendar days (UTC+8, no DST). They are not instants. The only place an
 *    instant appears is `leaveWindow`, which turns a run of days into the
 *    [start, end) window the occupancy module compares against.
 */

import { daysBetween, sgDayWindow, sgToday, type PlainDate } from '../../lib/time'

/** Singapore-time arithmetic lives in `lib/time`; re-exported so the leave rules
 *  still read as one vocabulary. */
export { daysBetween, sgToday, type PlainDate }

export type LeaveType = 'annual' | 'medical' | 'study'
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

// ── The Pool, and what is drawn from it ────────────────────────────────────

/** What a row contributes to a sum. Nothing else about it matters here. */
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
 * Deliberately not COMMITTED_STATUSES: that one is about the Pool, this one is
 * about a calendar, and they are free to diverge.
 */
export const OCCUPYING_STATUSES: readonly LeaveStatus[] = ['approved', 'pending']

/** What has actually been taken — the number an instructor sees as "used". */
export const TAKEN_STATUSES: readonly LeaveStatus[] = ['approved']
/** What a NEW submission is measured against. Pending counts too: that is what
 *  stops two simultaneous requests from together exceeding the Pool. */
export const COMMITTED_STATUSES: readonly LeaveStatus[] = ['approved', 'pending']

/** Which rows a sum counts: one Leave Type, one Leave Year, one set of statuses.
 *  The Leave Types and the two status sets are what keep Taken, Committed and
 *  each type's Pool from ever being the same number. */
export interface LeaveDaysScope {
  type: LeaveType
  leaveYear: number
  statuses: readonly LeaveStatus[]
}

/** Days are 0.5-grained; sum in halves so 0.5 + 0.5 + 0.5 is exactly 1.5. */
export function sumLeaveDays(rows: readonly LeaveDaysRow[], scope: LeaveDaysScope): number {
  let halves = 0
  for (const r of rows) {
    if (r.type !== scope.type) continue
    if (r.leaveYear !== scope.leaveYear) continue
    if (!scope.statuses.includes(r.status)) continue
    halves += Math.round(r.days * 2)
  }
  return halves / 2
}

/**
 * **Carried Days** into a Leave Year: what is left of the previous one, capped
 * by the studio-wide `cap` from Global Policy.
 *
 * Two rules live here rather than at the call sites, so that neither can be
 * forgotten by a future one:
 *
 *  - **Only annual carries.** Banking sick days year on year is not something
 *    the studio wants to owe, and study leave is use-it-or-lose-it for the same
 *    reason. Making it a branch of this function means no caller has to know
 *    that — a third Leave Type cost nothing here.
 *  - **A negative previous Remaining carries 0, not a debt.** A Pool lowered
 *    below what was already Committed shows an honest negative for that year
 *    (`leavePoolFigures` does not clamp), but the year boundary wipes it: the
 *    instructor starts January whole.
 *
 * Halves pass through exactly — `min`/`max` return one of their operands, so
 * 3.5 carried is 3.5. Where the previous year has no stored Pool at all the
 * caller passes nothing here and carries 0; this function never looks further
 * back than the one figure it is given, which is what makes the chain finite.
 */
export function carriedDays(type: LeaveType, previousRemaining: number, cap: number): number {
  if (type !== 'annual') return 0
  return Math.min(cap, Math.max(0, previousRemaining))
}

/**
 * A Leave Year's **Pool**: Assigned Days plus Carried Days.
 *
 * Trivial on purpose. It exists so that the materialisation wrapper in
 * `requests.ts` — the one piece of this feature no test can reach, because
 * there is no test database — performs no arithmetic of its own, and so that
 * carry-over has exactly one place to arrive (`carriedDays`, above).
 *
 * Both figures are 0.5-grained, and halves are exact in binary floating point,
 * so a half carried in comes out a half.
 */
export function poolDays(assigned: number, carried: number): number {
  return assigned + carried
}

/** What one Pool and one set of request rows work out to — the COMPUTATION's
 *  result, camelCase and internal. The snake_case API shapes built from it are
 *  `LeaveBalance` and `LeaveFiguresResponse` in `requests.ts`; keeping them
 *  apart is what lets a response field be renamed without touching a rule. */
export interface LeavePoolFigures {
  type: LeaveType
  pool: number
  /** Approved days only. */
  taken: number
  /** Awaiting a decision. Committed is `taken + pending`. */
  pending: number
  /** Pool − Committed. */
  remaining: number
}

/**
 * Every number for one instructor, one Leave Type, one Leave Year, from their
 * Pool and their request rows. All the arithmetic of a Pool read lives here;
 * `requests.ts` only fetches the rows and the Pool.
 *
 * Remaining subtracts **Committed** — pending as well as approved — so the
 * figure an instructor is shown is the one `checkLeaveSubmission` measures a new
 * request against. Taken stays approved-only alongside it, and the two are
 * different numbers whenever anything is awaiting a decision.
 *
 * Not clamped: a Pool lowered below what is already Committed shows an honest
 * negative, because hiding it would be a lie about where the instructor stands.
 */
export function leavePoolFigures(
  type: LeaveType,
  pool: number,
  rows: readonly LeaveDaysRow[],
  leaveYear: number,
): LeavePoolFigures {
  const scope = { type, leaveYear }
  const taken = sumLeaveDays(rows, { ...scope, statuses: TAKEN_STATUSES })
  const committed = sumLeaveDays(rows, { ...scope, statuses: COMMITTED_STATUSES })
  return { type, pool, taken, pending: committed - taken, remaining: pool - committed }
}

// ── The admin's adjustment ─────────────────────────────────────────────────

/**
 * The Pool that yields `desiredRemaining` — the inverse of the `pool − committed`
 * in `leavePoolFigures`, which is what makes the round trip exact: an admin types
 * the Remaining, and that is the number the instructor then sees.
 *
 * `committedDays` is **Committed** — pending as well as approved — because that
 * is what Remaining subtracts. Summed in halves for the same reason
 * `sumLeaveDays` is: 3.5 days taken and 9 wanted is a Pool of 12.5 exactly.
 *
 * Only the CURRENT Leave Year is adjustable: a future year has no stored Pool to
 * move and a past one is frozen history. That is the caller's business — this is
 * arithmetic.
 */
export function poolForRemaining(desiredRemaining: number, committedDays: number): number {
  return (Math.round(desiredRemaining * 2) + Math.round(committedDays * 2)) / 2
}

export type RemainingAdjustmentCode = 'remaining_above_pool' | 'remaining_below_zero'

/**
 * What an admin may set a Remaining to: anywhere from 0 up to `ceiling`, both
 * ends included.
 *
 * The ceiling is **Assigned Days plus Carried Days** — what the year was worth
 * before anyone touched it — and deliberately NOT the stored Pool. An adjustment back-solves the
 * Pool from the Remaining that was typed, so bounding against the stored Pool
 * would make every adjustment a one-way ratchet: a figure typed too low would
 * lower the Pool, and restoring the original number would then be refused as a
 * grant. Bounded against Assigned + Carried, a typo is correctable and giving
 * MORE than was agreed still needs Assigned Days raised first.
 *
 * Both refusals name the number they are measured against; that message is what
 * the admin is shown.
 */
export function checkRemainingAdjustment(
  type: LeaveType,
  desiredRemaining: number,
  ceiling: number,
): { ok: true } | { ok: false; code: RemainingAdjustmentCode; message: string } {
  if (desiredRemaining < 0) {
    return {
      ok: false,
      code: 'remaining_below_zero',
      message: `Remaining ${type} days cannot be negative. The lowest you can set is 0.`,
    }
  }
  if (desiredRemaining > ceiling) {
    return {
      ok: false,
      code: 'remaining_above_pool',
      message:
        `That is more than their ${ceiling} ${type} ${plural(ceiling)} for this year — ` +
        `their Assigned Days plus what they carried in — which is the most you can set. ` +
        `Raising their Assigned Days raises that ceiling.`,
    }
  }
  return { ok: true }
}

// ── Submission ─────────────────────────────────────────────────────────────

/** How far back a medical request may reach. It is the only type that may reach
 *  back at all — annual and study must both start after today. */
export const MEDICAL_BACKDATE_DAYS = 7

export type LeaveRefusalCode =
  | 'invalid_date_range'
  | 'half_day_requires_single_date'
  | 'leave_must_start_in_future'
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
  /** This instructor's **Pool** for this Leave Type and Leave Year — per person,
   *  not a studio-wide figure, and the number this request is drawn from. */
  pool: number
  /** This instructor's approved + pending days for this type and leave year. */
  committedDays: number
}

export type LeaveCheck =
  | { ok: true; days: number; leaveYear: number }
  | { ok: false; code: LeaveRefusalCode; message: string }

const plural = (n: number) => (n === 1 ? 'day' : 'days')
/** A Leave Type at the start of a sentence. */
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  // Everything that is not medical must start after today: only an illness is
  // filed after the fact. There is deliberately no minimum notice on top of
  // this — an admin who thinks a request came too late rejects it, with a
  // reason, which is a rule the pending queue already enforces.
  if (input.type !== 'medical' && startOffset < 1) {
    return {
      ok: false,
      code: 'leave_must_start_in_future',
      message: `${titleCase(input.type)} leave must start after today. Pick a later start date.`,
    }
  }
  if (input.type === 'medical' && startOffset < -MEDICAL_BACKDATE_DAYS) {
    return {
      ok: false,
      code: 'medical_leave_backdated_too_far',
      message: `Medical leave can be backdated by at most ${MEDICAL_BACKDATE_DAYS} days.`,
    }
  }

  const remaining = input.pool - input.committedDays
  if (days > remaining) {
    return {
      ok: false,
      code: 'insufficient_leave_balance',
      message:
        `That request is ${days} ${plural(days)}. Your ${input.type} Pool this year is ` +
        `${input.pool} ${plural(input.pool)}, with ${remaining} remaining — approved and ` +
        `pending requests both count.`,
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
 * Pool automatically: Committed is a sum over rows, so the row simply stops
 * being counted.
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
 * None of these need bookkeeping against the Pool. Taken and Committed are sums
 * over rows, so a rejected or revoked row simply stops counting.
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
