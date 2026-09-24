/**
 * The sentences a Refund is announced with (§14) — the admin's notice and the
 * member's email.
 *
 * Pure on purpose, for the same reason `notifications/purchase-email` is: the
 * renderer has no conditionals, so every fragment-shaped variable would produce
 * a wrong sentence for some purchase. Each variable here is a whole composed
 * sentence, and none of it needs a database, an SMTP server or Stripe to check.
 *
 * The portal renders these strings and derives nothing: **Untouched** is a
 * domain rule and lives on this side of the wire.
 */
import { sgFormat } from '../../lib/time'

/** "12 Jun 2026" — the studio's only clock. */
const SG_DATE = sgFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
/** "3 Sept 2026, 19:00" — a class a member has to recognise. */
const SG_DATETIME = sgFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * **Untouched** is a purchase no class it paid for has been attended or
 * no-showed on. A no-show counts as used — the class ran and the seat was held.
 * A booked class that has not yet happened leaves it Untouched, because
 * refunding simply cancels it.
 *
 * This is the whole of the rule: the caller's fold produces the count, and a
 * count of zero is Untouched.
 */
export function isUntouched(attendedCount: number): boolean {
  return attendedCount === 0
}

/**
 * The notice that sits above the Refund button. Null when the purchase is
 * Untouched — there is nothing to warn about, and an empty string would render
 * an empty box.
 *
 * Eligibility is a notice, not a gate: the admin reads this and may refund
 * anyway.
 *
 * "Used", with both halves named (#275): the count includes no-shows, and a
 * sentence that said "attended" disagreed with the roster whenever one did.
 */
export function attendedNotice(attendedCount: number, since: Date | null): string | null {
  if (isUntouched(attendedCount)) return null
  const classes = plural(attendedCount, 'class', 'classes')
  return since
    ? `${classes} used (attended or no-show) since ${SG_DATE.format(since)}`
    : `${classes} used (attended or no-show) on this purchase`
}

/**
 * What the Refund did to the entitlement. The provider sends the money receipt;
 * this is the sentence that says the plan has ended.
 */
export function voidedLine(packageName: string, amountSgd: string): string {
  return `${packageName} has been refunded in full (S$${amountSgd}) and no longer covers any bookings.`
}

export interface CancelledSession {
  name: string
  startsAt: Date
}

/**
 * The classes the Refund cancelled, named. Cancelling someone's booked classes
 * silently is not acceptable, so the empty case still says so out loud rather
 * than leaving the member to wonder.
 */
export function cancelledClassesLine(sessions: CancelledSession[]): string {
  if (sessions.length === 0) return 'You had no upcoming bookings on it, so nothing was cancelled.'
  const named = sessions
    .map(s => `${s.name} on ${SG_DATETIME.format(s.startsAt)}`)
    .join('; ')
  return `We have cancelled ${plural(sessions.length, 'upcoming booking', 'upcoming bookings')}: ${named}.`
}

/**
 * How long a part-paid Purchase may sit before the portal raises it (#95).
 *
 * Fourteen days, and the number is a judgement rather than a derivation: long
 * enough that a member who meant to come back with a second card still can,
 * short enough that the studio is not holding a stranger's money for a season.
 * Nothing happens when it elapses except that the row appears on a list — the
 * refund is always a person's decision, so being wrong here costs an admin a
 * glance and never a member their purchase.
 */
export const SILENT_AFTER_DAYS = 14

const DAY_MS = 86_400_000

/** Whole days between the last thing that happened on a Purchase and now. */
export function daysSilent(lastActivityAt: Date, now: Date): number {
  return Math.floor((now.getTime() - lastActivityAt.getTime()) / DAY_MS)
}

/**
 * Has this Purchase gone quiet? The clock runs from the **last** payment, not
 * the first: a member who paid a second card a week ago is mid-purchase, not
 * silent, and raising them would ask an admin to chase somebody who is still
 * going.
 */
export function isSilent(lastActivityAt: Date, now: Date): boolean {
  return daysSilent(lastActivityAt, now) >= SILENT_AFTER_DAYS
}

/** What the portal prints beside a silent Purchase. */
export function silenceNotice(lastActivityAt: Date, now: Date): string {
  const days = daysSilent(lastActivityAt, now)
  return `No payment for ${plural(days, 'day', 'days')} — last paid ${SG_DATE.format(lastActivityAt)}`
}

/**
 * What an abandoned refund put back, in the terms a bank statement uses (#95).
 *
 * The count matters as much as the total: one press of the button becomes one
 * provider call per payment, so a Purchase settled by two cards produces two
 * lines on the studio's statement. An admin reconciling the month needs to know
 * that before they start counting.
 */
export function abandonedReturnLine(paymentCount: number, amountSgd: string): string {
  return `${plural(paymentCount, 'payment', 'payments')} returned, totalling S$${amountSgd}`
}

/**
 * What the Refund did to a Purchase that granted nothing.
 *
 * Deliberately not `voidedLine`: there is no plan to say has stopped covering
 * bookings, and a member told their package "no longer covers any bookings"
 * would go looking for a package they never had.
 */
export function abandonedLine(itemName: string, amountSgd: string): string {
  return `Your unfinished purchase of ${itemName} has been cancelled and the S$${amountSgd} you had paid towards it returned in full.`
}

export interface RefundEmailInput {
  clientName: string
  packageName: string
  amountSgd: string
  cancelled: CancelledSession[]
  /** Where the member checks what they still hold. */
  accountUrl: string
}

export function composeRefundEmail(input: RefundEmailInput): {
  slug: 'purchase_refunded'
  variables: Record<string, string>
} {
  return {
    slug: 'purchase_refunded',
    variables: {
      client_name: input.clientName,
      package_name: input.packageName,
      refund_line: voidedLine(input.packageName, input.amountSgd),
      cancelled_line: cancelledClassesLine(input.cancelled),
      account_url: input.accountUrl,
    },
  }
}

export interface AbandonedRefundEmailInput {
  clientName: string
  /** What they were buying, frozen at checkout — never a package they hold. */
  itemName: string
  amountSgd: string
  accountUrl: string
}

/**
 * The member's email for a Purchase they never finished (#95).
 *
 * The **same template** as an ordinary Refund, with different sentences in it.
 * A second template would be a second thing for a studio to edit and keep in
 * step, and the member's question is identical either way: what happened to my
 * money. What differs is only that there is no entitlement to report the end of
 * and no booking to report the cancellation of — so `cancelled_line` says that
 * plainly rather than being left empty, which would render as a hole in the copy.
 */
export function composeAbandonedRefundEmail(input: AbandonedRefundEmailInput): {
  slug: 'purchase_refunded'
  variables: Record<string, string>
} {
  return {
    slug: 'purchase_refunded',
    variables: {
      client_name: input.clientName,
      package_name: input.itemName,
      refund_line: abandonedLine(input.itemName, input.amountSgd),
      cancelled_line:
        'Nothing had been issued to you on it — no package, no credits and no booking — so there was nothing to cancel.',
      account_url: input.accountUrl,
    },
  }
}
