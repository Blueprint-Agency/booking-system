/**
 * A member as a Customer at the payment provider, and the cards kept against
 * them (#185).
 *
 * Every checkout before this carried an email address and nothing else, so no
 * card was ever kept and there was nothing for a member to pick from. Part
 * Payment (#93) is the flow that makes that hurt: it is *designed* to be paid
 * twice, and the second time asked for the same sixteen digits again.
 *
 * ## The one rule
 *
 * **A Customer belongs to an account, not to a member.** A `cus_…` made on the
 * platform's account means nothing on a studio's own one (#100), so every
 * function here reads the studio's account first and keys everything on
 * `(tenant, member, account)`. That is also, exactly, why a card saved at one
 * studio can never appear at another: the Tenant is in the key, Row-Level
 * Security is under it, and a studio on its own credentials is not even talking
 * to the same provider account.
 *
 * ## What this deliberately does not do
 *
 * It never charges a saved card. Picking one happens on the provider's own
 * hosted page, with the member watching, which is why the session asks for
 * `setup_future_usage: 'on_session'` and not `off_session` — see
 * `checkout-session.ts`. Nothing here holds a card number, and nothing here
 * could: the closest it comes is a brand and four digits, read back from the
 * provider for a list the member looks at.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type Stripe from 'stripe'

import { db } from '../../db'
import { paymentCustomers } from '../../db/schema/ledger'
import {
  providerAccountForTenant,
  stripeForProviderAccount,
  stripeForTenant,
} from '../../lib/stripe'
import { outbound } from '../../lib/outbound'
import { NotFoundError } from '../../shared/errors'
import { reportError } from '../../shared/logger'

/** A saved card as the member's account page shows it. Never more than this. */
export interface SavedCard {
  /** The provider's id for the method — what "remove this one" names. */
  id: string
  /** `visa`, `mastercard`, … as the provider reports it. */
  brand: string
  /** The only four digits this platform ever sees. */
  last4: string
  expMonth: number
  expYear: number
}

/**
 * The row matching a member on one account. `providerAccountId` is compared
 * with `IS NULL` when it is null, because `= NULL` is never true — the same
 * trap the unique index's `NULLS NOT DISTINCT` exists to close, one layer up.
 */
const onAccount = (tenantId: string, clientId: string, accountId: string | null) =>
  and(
    eq(paymentCustomers.tenantId, tenantId),
    eq(paymentCustomers.clientId, clientId),
    accountId === null
      ? isNull(paymentCustomers.providerAccountId)
      : eq(paymentCustomers.providerAccountId, accountId),
  )

async function storedCustomer(
  tenantId: string,
  clientId: string,
  accountId: string | null,
): Promise<string | null> {
  const [row] = await db
    .select({ customerId: paymentCustomers.customerId })
    .from(paymentCustomers)
    .where(onAccount(tenantId, clientId, accountId))
    .limit(1)
  return row?.customerId ?? null
}

/**
 * Does this error mean the provider has never heard of the thing we named?
 *
 * The one provider error this module can act on, and the reason it has to:
 * a stored `cus_…` can stop existing without anything here being told. Someone
 * deletes it from the provider's dashboard, a studio's archive is restored
 * beside its source and brings the pointers with it, or a member deletion is
 * rolled back after the Customer has already gone. The row is then a pointer to
 * nothing, and left unhandled it fails **every future checkout for that member**
 * — the failure mode this whole file exists to avoid.
 */
function isMissingAtProvider(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  const type = (err as { type?: unknown } | null)?.type
  return code === 'resource_missing' || type === 'StripeInvalidRequestError'
}

/**
 * Drop a pointer the provider says is dead, so the next checkout makes a fresh
 * Customer instead of failing the same way forever.
 *
 * Scoped to the exact row, and never raised: this is housekeeping on the way
 * past, and a failure to tidy up must not become the member's error.
 */
export async function forgetStaleCustomer(
  tenantId: string,
  clientId: string,
  accountId: string | null,
  customerId: string,
): Promise<void> {
  try {
    await db
      .delete(paymentCustomers)
      .where(and(onAccount(tenantId, clientId, accountId), eq(paymentCustomers.customerId, customerId)))
    reportError(
      new Error(`provider Customer ${customerId} no longer exists; pointer dropped`),
      'dropped a stale provider Customer — the member will be made a new one on their next checkout',
      { tenantId, clientId, customerId, providerAccountId: accountId },
    )
  } catch (err) {
    reportError(err, 'could not drop a stale provider Customer', { tenantId, clientId, customerId })
  }
}

/**
 * The member's Customer id on the account this studio sells on, making one if
 * they are not a Customer there yet.
 *
 * Called on the checkout path, so it is on the critical path of a sale. It
 * therefore **never throws**: a provider that will not make a Customer right
 * now must not cost the studio the sale, and a null here simply means the
 * session falls back to `customer_email` — the shape every checkout had before
 * this existed, which works, and merely fails to keep the card.
 *
 * ## The race
 *
 * Two tabs, two checkouts, one member: both can find no row and both can ask
 * the provider for a Customer. `onConflictDoNothing` on the unique index means
 * exactly one of them is stored, and the loser re-reads the winner's. The
 * loser's Customer is then an empty record at the provider that nothing points
 * at — which is untidy and harmless, and far better than the alternative, where
 * a member's cards are split across two Customers and each screen shows them
 * half of their own wallet.
 */
export async function providerCustomerFor(input: {
  tenantId: string
  clientId: string
  email: string
  name?: string | null
}): Promise<string | null> {
  const { tenantId, clientId } = input
  try {
    const account = await providerAccountForTenant(tenantId)
    const accountId = account?.accountId ?? null

    const existing = await storedCustomer(tenantId, clientId, accountId)
    if (existing) return existing

    const stripe = await stripeForTenant(tenantId)
    const created = await outbound('stripe', 'customers.create', () =>
      stripe.customers.create({
        email: input.email,
        ...(input.name ? { name: input.name } : {}),
        // The Tenant and the member, on the provider's own record, for the same
        // reason the payment intent carries them: a dashboard or an export has
        // no other way to tell one studio's Customers from another's when both
        // sell on the platform's shared account.
        metadata: { tenant_id: tenantId, client_id: clientId },
      }),
    )

    const [stored] = await db
      .insert(paymentCustomers)
      .values({ tenantId, clientId, providerAccountId: accountId, customerId: created.id })
      .onConflictDoNothing()
      .returning({ customerId: paymentCustomers.customerId })
    if (stored) return stored.customerId

    // Lost the race. The winner's row is the one that counts.
    return await storedCustomer(tenantId, clientId, accountId)
  } catch (err) {
    // Logged, not raised. See the note above: a sale is worth more than a saved
    // card, and the caller's fallback is the behaviour that shipped for a year.
    reportError(err, 'could not put the member on the payment provider — this checkout keeps no card', {
      tenantId,
      clientId,
    })
    return null
  }
}

/**
 * Create a checkout session, and survive a Customer the provider has forgotten.
 *
 * Both session builders go through this, and it exists for one failure: the
 * stored `cus_…` is a pointer we cannot verify without a round trip on every
 * checkout, and a dead one makes `sessions.create` throw. Unhandled, that is
 * not a degraded checkout — it is a member who can never buy anything again,
 * because every attempt sends the same dead id.
 *
 * So the dead pointer is dropped and the session is built **once** more without
 * a Customer. That second attempt is the pre-#185 shape: it takes the money and
 * keeps no card, which is the right trade at the moment somebody is trying to
 * pay. Their next checkout makes them a Customer again.
 *
 * Only ever one retry, and only for "no such thing" — a declined card, a bad
 * amount or a provider outage must fail as itself rather than being retried as
 * though the Customer were at fault.
 */
export async function createSessionSurvivingStaleCustomer<T>(
  input: {
    tenantId: string
    clientId: string
    customerId: string | null
  },
  create: (customerId: string | null) => Promise<T>,
): Promise<T> {
  const { tenantId, clientId, customerId } = input
  if (!customerId) return create(null)
  try {
    return await create(customerId)
  } catch (err) {
    if (!isMissingAtProvider(err)) throw err
    const account = await providerAccountForTenant(tenantId).catch(() => null)
    await forgetStaleCustomer(tenantId, clientId, account?.accountId ?? null, customerId)
    return create(null)
  }
}

/**
 * The cards this member has kept at this studio, newest first.
 *
 * Read from the provider rather than mirrored into a table of our own. A card
 * expires, is replaced by the issuer, or is removed from the provider's
 * dashboard, and a local copy would go stale in exactly the way that makes a
 * member pick a card that no longer works. The pointer is ours; the cards are
 * the provider's.
 *
 * A member who is not a Customer here has no cards, which is an empty list and
 * not an error — it is the honest answer for everyone who has not yet ticked
 * the box.
 */
export async function listSavedCards(tenantId: string, clientId: string): Promise<SavedCard[]> {
  const account = await providerAccountForTenant(tenantId)
  const customerId = await storedCustomer(tenantId, clientId, account?.accountId ?? null)
  if (!customerId) return []

  const stripe = await stripeForTenant(tenantId)
  const methods = await outbound('stripe', 'paymentMethods.list', () =>
    // `limit` is explicit because the provider's default is **ten**, and a
    // silently truncated list is worse here than almost anywhere: the only way
    // to remove a card is to see it, so a card past the cut could never be
    // removed at all. A hundred is the provider's maximum and far past any
    // number of cards a person has; one page is therefore the whole list.
    stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 100 }),
  )
  return (methods?.data ?? []).map(describeCard).filter((card): card is SavedCard => card !== null)
}

/**
 * What a member may be told about a card of theirs, and nothing else.
 *
 * Built field by field rather than by spreading the provider's object, which is
 * the whole point: a provider adding a field to its payment method must not be
 * able to add a field to this platform's API response. A method with no `card`
 * on it is not a card — this API version can return a handful of other types —
 * and is dropped rather than rendered as a row with empty digits.
 */
export function describeCard(method: Stripe.PaymentMethod): SavedCard | null {
  const card = method.card
  if (!card) return null
  return {
    id: method.id,
    brand: card.brand,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
  }
}

/**
 * Is this payment method the given Customer's?
 *
 * The provider returns `customer` as a bare id or as an expanded object
 * depending on the call, and both are read here. Trusting one shape is how an
 * ownership check quietly starts answering "no" for everyone — or, far worse,
 * "yes": a missing or unrecognised `customer` must never compare equal, which
 * is why the absent case is spelt out rather than left to `undefined ===
 * undefined`.
 */
export function cardBelongsTo(
  method: Pick<Stripe.PaymentMethod, 'customer'> | null | undefined,
  customerId: string,
): boolean {
  const owner = typeof method?.customer === 'string' ? method.customer : method?.customer?.id
  return Boolean(owner) && owner === customerId
}

/**
 * Forget one of the member's cards.
 *
 * **Ownership is checked against the provider, not against the request.** The
 * id in the URL is a string the browser chose, and a payment method id is not a
 * secret — so the method is fetched and its `customer` compared with the one
 * this member is on this account. Without that, removing a card would be a
 * route by which any signed-in member could detach any card at any studio.
 *
 * Detached, not deleted: the provider keeps the record against the payments it
 * made, which the studio's accounts and any future Refund still need. What goes
 * is the member's ability to pick it again, which is what "remove" means here.
 */
export async function removeSavedCard(input: {
  tenantId: string
  clientId: string
  paymentMethodId: string
}): Promise<void> {
  const { tenantId, clientId, paymentMethodId } = input
  const account = await providerAccountForTenant(tenantId)
  const customerId = await storedCustomer(tenantId, clientId, account?.accountId ?? null)
  if (!customerId) throw new NotFoundError('card_not_found')

  const stripe = await stripeForTenant(tenantId)
  // An id the provider has never heard of is **the same 404** as a card that
  // is not this member's. Letting it escape as a 500 would have made the two
  // distinguishable, which is exactly the existence oracle the ownership check
  // below exists to close — and would have turned an ordinary stale tab (the
  // card was removed elsewhere a second ago) into an unhandled error.
  let method: Stripe.PaymentMethod
  try {
    method = await outbound('stripe', 'paymentMethods.retrieve', () =>
      stripe.paymentMethods.retrieve(paymentMethodId),
    )
  } catch (err) {
    if (isMissingAtProvider(err)) throw new NotFoundError('card_not_found')
    throw err
  }
  // Not theirs — answered as "no such card" rather than "not yours", for the
  // same reason.
  if (!cardBelongsTo(method, customerId)) throw new NotFoundError('card_not_found')

  await outbound('stripe', 'paymentMethods.detach', () =>
    stripe.paymentMethods.detach(paymentMethodId),
  )
}

/**
 * Move the member's address on their Customer, wherever they are one (#185).
 *
 * Called when a studio corrects a member's email. A session carrying a Customer
 * does not carry `customer_email`, so the provider reads the address off the
 * Customer — and an address frozen at somebody's first checkout is the address
 * their receipts keep going to years later.
 *
 * **Every account**, for the same reason deletion reaches every account: a
 * studio that has moved has a Customer on the account before the move as well,
 * and a Refund receipt from that account should not carry an address the member
 * no longer reads.
 *
 * Never throws. The studio's own directory is the record that matters, and a
 * provider that is unreachable must not refuse a correction.
 */
export async function syncProviderCustomerEmail(
  tenantId: string,
  clientId: string,
  email: string,
): Promise<void> {
  let rows: { customerId: string; providerAccountId: string | null }[]
  try {
    rows = await db
      .select({
        customerId: paymentCustomers.customerId,
        providerAccountId: paymentCustomers.providerAccountId,
      })
      .from(paymentCustomers)
      .where(and(eq(paymentCustomers.tenantId, tenantId), eq(paymentCustomers.clientId, clientId)))
  } catch (err) {
    reportError(err, 'could not read the member’s provider Customers to move their email', {
      tenantId,
      clientId,
    })
    return
  }

  for (const row of rows) {
    try {
      const stripe = await stripeForProviderAccount(tenantId, row.providerAccountId)
      await outbound('stripe', 'customers.update', () =>
        stripe.customers.update(row.customerId, { email }),
      )
    } catch (err) {
      reportError(err, 'could not move the member’s email at the payment provider', {
        tenantId,
        clientId,
        customerId: row.customerId,
        providerAccountId: row.providerAccountId,
      })
    }
  }
}

/**
 * Remove the member from the payment provider entirely (#144, #185).
 *
 * Deleting a Customer takes its saved cards with it, which is the point: a
 * member who asked to be deleted did not ask to stay on file at a third party.
 * The provider keeps its own record of the *payments* — those are the studio's
 * accounts, and no platform can delete them — but the person is gone from it.
 *
 * **Every account, not just today's.** A studio that has moved onto its own
 * credentials has a row here per account it has ever sold on, and a member
 * deleted after the move must not be left behind on the account before it. The
 * ones this platform no longer holds a key for cannot be reached at all; those
 * are reported and skipped, because a provider that cannot be called must not
 * stop a deletion the member asked for and the database has already done.
 *
 * Returns the ids it dealt with, so the caller can say what happened. It never
 * throws: see above.
 */
export async function forgetProviderCustomers(tenantId: string, clientId: string): Promise<string[]> {
  // Inside the try as well, because the promise this makes is "never throws"
  // and `member-delete.ts` leans on it: a read that failed here must not abort
  // a deletion the member asked for.
  let rows: { customerId: string; providerAccountId: string | null }[]
  try {
    rows = await db
      .select({
        customerId: paymentCustomers.customerId,
        providerAccountId: paymentCustomers.providerAccountId,
      })
      .from(paymentCustomers)
      .where(and(eq(paymentCustomers.tenantId, tenantId), eq(paymentCustomers.clientId, clientId)))
  } catch (err) {
    reportError(err, 'could not read the member’s provider Customers before deletion', {
      tenantId,
      clientId,
    })
    return []
  }

  const forgotten: string[] = []
  for (const row of rows) {
    try {
      // Bound to the account the Customer was made on, by the same rule a
      // Refund is: an id belongs to the account that issued it, and asking
      // today's credentials about yesterday's Customer fails naming an id that
      // looks perfectly correct.
      const stripe = await stripeForProviderAccount(tenantId, row.providerAccountId)
      await outbound('stripe', 'customers.del', () => stripe.customers.del(row.customerId))
      forgotten.push(row.customerId)
    } catch (err) {
      reportError(err, 'could not remove the member from the payment provider', {
        tenantId,
        customerId: row.customerId,
        providerAccountId: row.providerAccountId,
      })
    }
  }
  return forgotten
}
