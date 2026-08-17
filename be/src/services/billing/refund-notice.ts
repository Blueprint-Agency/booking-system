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
 */
export function attendedNotice(attendedCount: number, since: Date | null): string | null {
  if (isUntouched(attendedCount)) return null
  const classes = plural(attendedCount, 'class', 'classes')
  return since
    ? `${classes} attended since ${SG_DATE.format(since)}`
    : `${classes} attended on this purchase`
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
