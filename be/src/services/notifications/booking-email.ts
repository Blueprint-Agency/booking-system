/**
 * The sentences the booking and cancellation emails are made of (#359:
 * NTF-08..11).
 *
 * The renderer is `{{var}}` substitution with no conditionals, so a fragment
 * that is right for one package kind is wrong for another: "0 credits remain"
 * on an Unlimited Plan, or a refund line on a cancellation that returned
 * nothing. Each line here is a whole sentence, chosen in code, the way
 * `./purchase-email.ts` composes the purchase confirmations.
 *
 * Pure on purpose: nothing here reads the database or the clock.
 */
import type { PurchasedKind } from './purchase-email'

/** Both forms are spelled out — a few nouns do not need an English pluraliser. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A trial pass counts classes: a first-timer has never heard of a credit. */
const unitOf = (kind: PurchasedKind) => (kind === 'trial' ? (['class', 'classes'] as const) : (['credit', 'credits'] as const))

/**
 * What a class booking cost the package that paid for it (NTF-08): the credits
 * it used and what is left, or, on an Unlimited Plan, that it used none.
 */
export function bookingCreditsLine(input: {
  kind: PurchasedKind
  packageName: string
  used: number
  /** Null on an Unlimited Plan, which has no balance. */
  remaining: number | null
}): string {
  if (input.kind === 'unlimited') return 'Booked on your Unlimited Plan, so no credits were used.'
  const [one, many] = unitOf(input.kind)
  const remaining = input.remaining ?? 0
  return `This booking used ${plural(input.used, one, many)} from ${input.packageName}, and ${plural(remaining, one, many)} ${remaining === 1 ? 'remains' : 'remain'} on it.`
}

/**
 * What came back when the studio cancelled a class (NTF-10): the credits
 * returned, or — for a booking that spent none, as an Unlimited Plan's does —
 * that there was nothing to return.
 */
export function classRefundLine(creditsReturned: number): string {
  return creditsReturned > 0
    ? `${plural(creditsReturned, 'credit has', 'credits have')} been returned to your package.`
    : 'The booking did not use any credits, so nothing was taken from your package.'
}

/**
 * The refund line on a private-session cancellation (NTF-10, NTF-11): the
 * sessions returned, or empty when none were — the line is left out rather
 * than saying something false.
 */
export function sessionsRefundLine(sessionsReturned: number): string {
  return sessionsReturned > 0
    ? `${plural(sessionsReturned, 'session has', 'sessions have')} been returned to your package.`
    : ''
}

/**
 * The private session a cancellation is about, as the subject and the first
 * sentence name it: a scheduled one by its instructor and time, a request that
 * was never scheduled as just that.
 */
export function privateSessionLine(session: { instructorName: string; startsAt: string } | null): string {
  return session ? `Your private session with ${session.instructorName} on ${session.startsAt}` : 'Your private session request'
}
