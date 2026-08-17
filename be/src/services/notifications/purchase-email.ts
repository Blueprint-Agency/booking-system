/**
 * The sentences a purchase confirmation is made of (§13).
 *
 * The renderer is `{{var}}` substitution with HTML-escaping and **no
 * conditionals**, so a template cannot say two things. Any fragment-shaped
 * variable therefore produces a wrong sentence for some package kind — a bare
 * credit count reads as nothing at all on an Unlimited Plan, and a bare date is
 * a lie on one bought Dormant. Every variable here is a whole composed
 * sentence, which is what keeps ONE template correct for four kinds without
 * touching the renderer.
 *
 * Pure on purpose: it imports the studio's clock and nothing else, so the
 * copy that promises Activation can be checked without a database, an SMTP
 * server or a payment provider.
 */
import { sgFormat } from '../../lib/time'
import { isDormant } from '../packages/validity'

export type PurchasedKind = 'credit_bundle' | 'unlimited' | 'trial' | 'pt'

/** "14 Feb 2027" — a date a member reads, in the studio's only clock. */
const SG_DATE = sgFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Both forms are spelled out — four nouns do not need an English pluraliser. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * What was bought, as a phrase. Replaces `credits_or_sessions`, which was null
 * for an Unlimited Plan and so left any label a template wrapped around it
 * dangling.
 */
export function contentsLine(kind: PurchasedKind, creditsOrSessions: number | null): string {
  const n = creditsOrSessions ?? 0
  switch (kind) {
    case 'unlimited':
      return 'Unlimited classes'
    case 'credit_bundle':
      return plural(n, 'class credit', 'class credits')
    case 'pt':
      return plural(n, 'private session', 'private sessions')
    // A first-timer has never heard of a credit, so a trial pass counts classes.
    case 'trial':
      return plural(n, 'class', 'classes')
  }
}

/**
 * How long it lasts, as a sentence — chosen by the state of the purchase, never
 * by the code path that made it.
 *
 * A **Dormant** plan is the only purchase with no date to print: it is paid for
 * and its clock has not started, so its line names **Activation** as the first
 * booking the plan pays for. `durationMonths` is the Duration frozen onto the
 * plan at purchase, so the sentence stays true if an admin later edits the
 * catalogue.
 *
 * Only an Unlimited Plan can ever be Dormant, and an Unlimited Plan bought when
 * the member holds no live plan is **not** Dormant — its clock started at
 * purchase and it has a real end date, which is the date that member is owed.
 * That is why this reads `isDormant` rather than the kind alone: the activation
 * promise reaches exactly the plans it is true of, and no Credit Bundle can be
 * edited into it from a template.
 */
export function validityLine(
  kind: PurchasedKind,
  expiresAt: Date | null,
  durationMonths: number | null,
): string {
  if (isDormant({ kind, expiresAt })) {
    return `Valid ${plural(durationMonths ?? 0, 'month', 'months')} from your first class — your plan activates when you make your first booking.`
  }
  // Everything else is dated: `client_packages_kind_fields` makes an absent
  // expiry impossible for every kind but Unlimited, and an Unlimited without one
  // is Dormant and already handled above.
  return expiresAt ? `Expires ${SG_DATE.format(expiresAt)}` : 'See your account for the expiry date'
}

/**
 * A first-timer's welcome and a $150 receipt are not the same email, and with
 * no conditionals in the renderer, different copy has no other home.
 *
 * Read off the granted package's **kind**, not the path that granted it: a
 * *priced* trial goes through the payment provider and the webhook, so a
 * path-based branch would send it the paid-package email.
 */
export function purchaseSlug(
  kind: PurchasedKind,
): 'package_purchase_confirmed' | 'trial_pass_purchase_confirmed' {
  return kind === 'trial' ? 'trial_pass_purchase_confirmed' : 'package_purchase_confirmed'
}

export interface PurchaseEmailInput {
  kind: PurchasedKind
  clientName: string
  packageName: string
  creditsOrSessions: number | null
  expiresAt: Date | null
  /** Frozen Duration in whole calendar months — Unlimited Plans only. */
  durationMonths: number | null
  /** The provider's receipt for a paid purchase; null on the free paths. */
  receiptUrl: string | null
  /** Where a free purchase points instead — the page that lists what they own. */
  accountUrl: string
}

/**
 * The whole email, as the five allow-listed variables. `receipt_url` is never
 * empty: an escaped empty value inside an href renders a visible link that goes
 * nowhere, so a purchase with no receipt links the account page instead (the
 * anchor text is neutral, and correct either way).
 */
export function composePurchaseEmail(input: PurchaseEmailInput): {
  slug: ReturnType<typeof purchaseSlug>
  variables: Record<string, string>
} {
  return {
    slug: purchaseSlug(input.kind),
    variables: {
      client_name: input.clientName,
      package_name: input.packageName,
      contents_line: contentsLine(input.kind, input.creditsOrSessions),
      validity_line: validityLine(input.kind, input.expiresAt, input.durationMonths),
      receipt_url: input.receiptUrl || input.accountUrl,
    },
  }
}
