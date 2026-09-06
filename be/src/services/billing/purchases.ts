/**
 * The Purchase record: what was bought, what it costs, how much has been paid.
 *
 * Every sale opens one — a plan, a workshop, Merch, a standalone Cross-Location
 * Add-On alike — and every payment the provider confirms is written against it.
 * The grant then depends on one question and not on the payment that triggered
 * it: is there anything still outstanding?
 *
 * Nothing here changes what a member or an admin sees. A sale paid in full at
 * the first attempt settles on that first payment, which is every sale this
 * system takes today. Part payment is #92; this is the record it will need.
 */
import { and, eq } from 'drizzle-orm'

import { db } from '../../db'
import { purchases, stripePayments } from '../../db/schema/ledger'
import { toCents, toSgd } from '../../shared/money'
import { amountPaidCents, isSettled, outstandingCents } from './balance'

export type PurchaseRow = typeof purchases.$inferSelect
export type PurchaseKind = PurchaseRow['kind']

export interface OpenPurchaseInput {
  tenantId: string
  clientId: string
  kind: PurchaseKind
  /** The whole charge, in cents, exactly as the checkout lines add up. */
  totalCents: number
  /** What the webhook will grant from, frozen beside the price. */
  metadata: Record<string, string>
}

/**
 * Open a Purchase for a sale about to reach the payment provider.
 *
 * The price is frozen here and never recomputed. A free purchase never gets
 * this far: it skips the provider entirely and is granted on the spot, so there
 * is no money for a Purchase to own — see `grantsWithoutPaying`.
 */
export async function openPurchase(input: OpenPurchaseInput): Promise<PurchaseRow> {
  const [row] = await db
    .insert(purchases)
    .values({
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: input.kind,
      totalSgd: toSgd(input.totalCents),
      amountPaidSgd: '0.00',
      status: 'open',
      metadata: input.metadata,
    })
    .returning()
  return row!
}

/**
 * A sale with nothing left to charge — a free product, or a discount that took
 * the total to zero. It skips the payment provider entirely and is granted on
 * the spot, so its Purchase is opened and closed in the same breath: a total of
 * zero leaves nothing outstanding, which is the same rule every other sale
 * settles by rather than an exception to it.
 *
 * It exists because a Purchase is the record of a sale, not of a payment. A
 * free trial pass and a $500 plan are both things a member acquired on a day,
 * and a history that shows only the ones that moved money is a history with
 * holes in it.
 */
export async function openSettledPurchase(
  input: Omit<OpenPurchaseInput, 'totalCents'>,
): Promise<PurchaseRow> {
  const [row] = await db
    .insert(purchases)
    .values({
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: input.kind,
      totalSgd: '0.00',
      amountPaidSgd: '0.00',
      status: 'paid',
      metadata: input.metadata,
      settledAt: new Date(),
    })
    .returning()
  return row!
}

/**
 * Remember the checkout session now in flight against this Purchase.
 *
 * The session id is what the confirmation page's `sync-session` fallback and a
 * later resume both name, and one Purchase holds one at a time on purpose.
 */
export async function attachCheckoutSession(
  tenantId: string,
  purchaseId: string,
  checkoutSessionId: string,
): Promise<void> {
  await db
    .update(purchases)
    .set({ checkoutSessionId })
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, purchaseId)))
}

/** The Purchase a webhook's session metadata names, or null when it names none. */
export async function purchaseById(
  tenantId: string,
  purchaseId: string,
): Promise<PurchaseRow | null> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, purchaseId)))
    .limit(1)
  return row ?? null
}

export interface Settlement {
  /** True when nothing is outstanding — the only state in which anything is granted. */
  settled: boolean
  paidCents: number
  outstandingCents: number
}

/**
 * Recompute what has been paid, from the payment rows, and say whether the
 * Balance has reached zero.
 *
 * The stored `amount_paid_sgd` is written from the ledger, never added to: a
 * running total that a redelivery could increment twice is precisely the bug
 * this record exists to make impossible.
 *
 * `creditingIntentId` is the payment being processed right now, whose row the
 * webhook has inserted but not yet flipped to `succeeded` — that flip waits for
 * the grant, so that a crash between the two is recovered by the provider's
 * next redelivery. See `balance.ts`.
 */
export async function recomputeBalance(
  tenantId: string,
  purchase: PurchaseRow,
  creditingIntentId?: string | null,
): Promise<Settlement> {
  const rows = await db
    .select({
      paymentIntentId: stripePayments.paymentIntentId,
      amountSgd: stripePayments.amountSgd,
      status: stripePayments.status,
    })
    .from(stripePayments)
    .where(
      and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.purchaseId, purchase.id)),
    )

  const totalCents = toCents(purchase.totalSgd)
  const paidCents = amountPaidCents(rows, creditingIntentId)
  const settled = isSettled(totalCents, paidCents)

  await db
    .update(purchases)
    .set({
      amountPaidSgd: toSgd(paidCents),
      // A refunded Purchase stays refunded: the unwind is the later word on it,
      // and a redelivery of the original payment must not reopen it as paid.
      ...(purchase.status === 'refunded'
        ? {}
        : { status: settled ? ('paid' as const) : ('open' as const) }),
      ...(settled && !purchase.settledAt ? { settledAt: new Date() } : {}),
    })
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, purchase.id)))

  return { settled, paidCents, outstandingCents: outstandingCents(totalCents, paidCents) }
}
