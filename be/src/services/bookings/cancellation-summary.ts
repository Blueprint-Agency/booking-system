/**
 * What a cancelled booking says of its cancellation, read the same way
 * wherever it is shown (#349, #351, #352): **when** it was cancelled, **who**
 * cancelled, **where the credit went** — and the two lines that say so, worded
 * here once for the member and for staff, so neither app words a cancel its own
 * way. Built only from what the cancel recorded: the booking's `refund_outcome`
 * and credits spent, and its `cancellations` row. Pure.
 *
 *   - Who: a `cancellations` row with `source='client'` is the member's own;
 *     `system` is the studio's machinery (a Void, a Remove, a Package rule
 *     change) — **automatic**; admin or instructor is the named staff member,
 *     or the studio unnamed for a row written before #350, or no row at all.
 *     Where no row is written to say — a workshop place, a corporate request, a
 *     private-session request ended while pending, a 2on1 partner reading the
 *     host's cancel — the caller says who (`by`).
 *   - Late: a member's cancel inside the Cancellation Window (a **Late
 *     cancel**). A studio cancel is never the member's late cancel.
 *   - Outcome: the credit came back (`credit_returned`; a private session's
 *     session counts as its credit); money was refunded (`refunded`, a
 *     workshop); nothing was spent, or there is nowhere to return it
 *     (`nothing_to_return`); otherwise the credit was kept — because the
 *     member cancelled late, over their Cancellation Cap, or because staff
 *     chose Keep credit.
 *   - Lines: the member's ("You cancelled", "Cancelled over your cap · credit
 *     not returned") and staff's ("Member" / the staff member's name /
 *     "Automatic" / "Studio", "Cancelled over their cap · credit not
 *     returned"). The outcome line is one sentence for both, but for whose cap
 *     and card it is. A credit is "returned" or "not returned", never
 *     "refunded" (only a workshop's money is), and never "kept", which a
 *     member read as theirs to keep when the studio was keeping it.
 */
import type { CancellationSource, RefundOutcome } from '../../db/enums'

export type CancelKind = 'class' | 'pt' | 'workshop' | 'corporate'

/** Who cancelled, as the member reads it. */
export type CancelledBy = 'member' | 'studio' | 'host'

/**
 * Who cancelled: the member, the named staff member, the studio's machinery,
 * the studio unnamed — or, to a 2on1 partner, the host who cancelled their
 * own request.
 */
export type CancelActor = 'member' | 'host' | 'staff' | 'automatic' | 'studio'

export type CancellationOutcome =
  | 'credit_returned'
  | 'credit_kept_late'
  | 'credit_kept_over_cap'
  | 'credit_kept'
  | 'refunded'
  | 'nothing_to_return'

/** A booking's `cancellations` row, as the summary reads it. */
export interface CancellationRecord {
  source: CancellationSource
  wasWithinWindow: boolean
  wasWithinCap: boolean
  cancelledAt: Date
  /** The staff member `cancelled_by_staff_id` names, by name. */
  staffName?: string | null
}

export interface CancellationFacts {
  kind: CancelKind
  refundOutcome: RefundOutcome | null
  creditsUsed: number
  /** The booking's own cancel time (a request's resolve time). */
  bookingCancelledAt: Date | null
  /** Its `cancellations` row, when there is one. */
  record: CancellationRecord | null
  /** Who cancelled, where no `cancellations` row says: it overrides the row's. */
  by?: { actor: CancelActor; staffName?: string | null }
  /**
   * A private-session request ended while pending: it held sessions, never a
   * booking. `expired` is nobody's cancel.
   */
  request?: 'cancelled' | 'expired'
}

export interface CancellationLines {
  /** Who: the member's "You cancelled" / "Cancelled" / "Expired"; staff's actor. */
  who: string
  /** Where the credit went, and why when it was kept. */
  outcome: string
}

export interface CancellationSummary {
  cancelledAt: Date | null
  /** Who, as the member reads it; null when the request expired. */
  cancelledBy: CancelledBy | null
  /** Who cancelled, as staff read it. */
  actor: CancelActor
  /** The staff member's name when `actor` is `staff`; null otherwise. */
  staffName: string | null
  late: boolean
  expired: boolean
  outcome: CancellationOutcome
  member: CancellationLines
  staff: CancellationLines
}

function actorOf(f: CancellationFacts): { actor: CancelActor; staffName: string | null } {
  if (f.request === 'expired') return { actor: 'automatic', staffName: null }
  if (f.by) return { actor: f.by.actor, staffName: f.by.staffName ?? null }
  const staffName = f.record?.staffName ?? null
  switch (f.record?.source) {
    case 'client':
      return { actor: 'member', staffName: null }
    case 'system':
      return { actor: 'automatic', staffName: null }
    default:
      return { actor: staffName ? 'staff' : 'studio', staffName }
  }
}

export function summarizeCancellation(f: CancellationFacts): CancellationSummary {
  // A member who cancelled before the studio cancelled the whole class keeps
  // their own row: a whole-class cancel touches only confirmed bookings.
  const byMember = f.record?.source === 'client'
  const late = byMember && !f.record!.wasWithinWindow
  let outcome: CancellationOutcome
  if (f.refundOutcome === 'credit_returned' || f.refundOutcome === 'session_returned') outcome = 'credit_returned'
  else if (f.refundOutcome === 'stripe_refunded') outcome = 'refunded'
  else if (f.refundOutcome === 'n_a' || f.creditsUsed === 0) outcome = 'nothing_to_return'
  else if (late) outcome = 'credit_kept_late'
  else if (byMember && !f.record!.wasWithinCap) outcome = 'credit_kept_over_cap'
  else outcome = 'credit_kept'
  const { actor, staffName } = actorOf(f)
  const expired = f.request === 'expired'
  const s = { kind: f.kind, credits: f.creditsUsed, actor, late, expired, request: !!f.request, outcome }
  return {
    cancelledAt: f.record?.cancelledAt ?? f.bookingCancelledAt,
    cancelledBy: expired ? null : actor === 'member' || actor === 'host' ? actor : 'studio',
    actor,
    staffName: actor === 'staff' ? staffName : null,
    late,
    expired,
    outcome,
    member: { who: memberWho(s), outcome: outcomeLine(s, 'your') },
    staff: { who: staffWho(actor, staffName), outcome: outcomeLine(s, 'their') },
  }
}

type Said = {
  kind: CancelKind
  credits: number
  actor: CancelActor
  late: boolean
  expired: boolean
  request: boolean
  outcome: CancellationOutcome
}

function memberWho(s: Said): string {
  if (s.expired) return 'Expired'
  if (s.actor === 'member') return 'You cancelled'
  // The one outcome line that does not say who.
  if (s.kind === 'workshop' && s.outcome === 'refunded') return 'Cancelled by the studio'
  return 'Cancelled'
}

function staffWho(actor: CancelActor, staffName: string | null): string {
  switch (actor) {
    case 'member':
    case 'host':
      return 'Member'
    case 'staff':
      return staffName ?? 'Staff'
    case 'automatic':
      return 'Automatic'
    case 'studio':
      return 'Studio'
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The outcome line; `whose` is the member's "your" or staff's "their". */
function outcomeLine(s: Said, whose: 'your' | 'their'): string {
  if (s.kind === 'corporate') return 'Cancelled by the studio'
  if (s.kind === 'workshop') {
    return s.outcome === 'refunded'
      ? `Refunded to ${whose} card`
      : 'Cancelled by the studio · any refund is arranged by the studio'
  }
  const unit = s.kind === 'pt' ? 'session' : 'credit'
  // A private session with nothing to return is a 2on1 partner's, who paid
  // nothing: their line says only who cancelled.
  const what =
    s.outcome === 'credit_returned'
      ? s.credits > 1
        ? `${s.credits} ${unit}s returned`
        : `${unit} returned`
      : s.outcome === 'nothing_to_return' || s.outcome === 'refunded'
        ? s.kind === 'pt'
          ? null
          : 'nothing to return'
        : `${unit} not returned`
  const and = what ? ` · ${what}` : ''
  if (s.expired) return `Request expired${and}`
  if (s.actor === 'member') {
    if (s.request) return `Request cancelled${and}`
    if (s.late) return `Late cancel · ${what ?? 'nothing to return'}`
    if (s.outcome === 'credit_kept_over_cap') return `Cancelled over ${whose} cap · ${what}`
    return capitalize(what ?? 'nothing to return')
  }
  return `Cancelled by ${s.actor === 'host' ? 'the host' : 'the studio'}${and}`
}

/**
 * How a private-session request ended while pending, as the summary's facts:
 * it has no `cancellations` row, so its own `cancel_source` says who — the
 * member, the named staff member, or the studio's machinery. A system cancel
 * at or past `expires_at` is its expiry; one before it a Complimentary
 * Package's Remove, which names its admin in `resolved_by_staff_id` yet is no
 * staff cancel (#352). A request cancelled before the source was recorded
 * falls back to its resolver: a staff member, else expiry once past
 * `expires_at`, else the member.
 */
export function pendingRequestEnd(r: {
  cancelSource: CancellationSource | null
  resolvedByStaffId: string | null
  staffName: string | null
  expiresAt: Date | null
  resolvedAt: Date | null
}): Pick<CancellationFacts, 'request' | 'by'> {
  const machinery = r.cancelSource ? r.cancelSource === 'system' : !r.resolvedByStaffId
  if (machinery && r.expiresAt && r.resolvedAt && r.resolvedAt >= r.expiresAt) return { request: 'expired' }
  if (r.cancelSource === 'system') return { request: 'cancelled', by: { actor: 'automatic' } }
  if (r.cancelSource === 'client' || (!r.cancelSource && !r.resolvedByStaffId)) {
    return { request: 'cancelled', by: { actor: 'member' } }
  }
  return { request: 'cancelled', by: { actor: r.staffName ? 'staff' : 'studio', staffName: r.staffName } }
}

/** A cancellations row, or none, as the summary reads it. */
export function cancellationRecord(r: {
  source: CancellationSource | null
  wasWithinWindow: boolean | null
  wasWithinCap: boolean | null
  cancelledAt: Date | string | null
  staffName?: string | null
}): CancellationRecord | null {
  if (r.source === null) return null
  return {
    source: r.source,
    wasWithinWindow: r.wasWithinWindow!,
    wasWithinCap: r.wasWithinCap!,
    cancelledAt: new Date(r.cancelledAt!),
    staffName: r.staffName ?? null,
  }
}

/**
 * A cancellation as the portal's reads send it — the profile's Cancelled tab
 * and the roster's Cancelled section alike, so staff read one shape.
 */
export function staffCancellationJson(s: CancellationSummary) {
  return {
    cancelled_at: s.cancelledAt?.toISOString() ?? null,
    cancelled_by: s.actor,
    cancelled_by_name: s.staffName,
    late: s.late,
    outcome: s.outcome,
    who_line: s.staff.who,
    outcome_line: s.staff.outcome,
  }
}

/** The same for the member's own reads: who as they read it, and their lines. */
export function memberCancellationJson(s: CancellationSummary) {
  return {
    cancelled_at: s.cancelledAt?.toISOString() ?? null,
    cancelled_by: s.cancelledBy,
    late: s.late,
    expired: s.expired,
    outcome: s.outcome,
    who_line: s.member.who,
    outcome_line: s.member.outcome,
  }
}
