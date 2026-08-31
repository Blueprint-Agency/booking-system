/**
 * Buying merch, and the member's own history of it.
 *
 * The same shape as the workshop and package checkouts (`CheckoutQuote`): price
 * it here, let the route hand the lines to Stripe, and let the webhook record
 * what was delivered. No Promo Codes and no quantity — one item, one purchase.
 * Nothing is shipped, so there is nothing to fulfil: the order row is the
 * receipt the studio hands the item over against.
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { merch, merchOrders } from '../../db/schema/catalog'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { toCents } from '../../shared/money'
import {
  grantsWithoutPaying,
  saleDescription,
  type CheckoutQuote,
} from '../billing/checkout-session'
import { tenantDisplayName } from '../tenants/mail-identity'

export type MerchOrderRow = typeof merchOrders.$inferSelect
export type MerchCheckout = CheckoutQuote<{ orderId: string }>

export async function beginMerchCheckout(input: {
  tenantId: string
  clientId: string
  merchId: string
}): Promise<MerchCheckout> {
  const [item] = await db
    .select()
    .from(merch)
    .where(and(eq(merch.tenantId, input.tenantId), eq(merch.id, input.merchId)))
    .limit(1)
  if (!item) throw new NotFoundError('merch_not_found')
  if (item.archivedAt) throw new BadRequestError('merch_not_available')

  const totalCents = toCents(item.priceSgd)

  // A free item still becomes an order — it is the line the studio hands it over
  // against — it just never reaches the payment provider.
  if (grantsWithoutPaying(totalCents)) {
    const order = await recordMerchOrder({
      tenantId: input.tenantId,
      clientId: input.clientId,
      merchId: item.id,
      title: item.title,
      amountSgd: '0.00',
      paymentIntentId: null,
    })
    return { outcome: 'granted', orderId: order.id }
  }

  return {
    outcome: 'checkout',
    lines: [
      {
        name: item.title,
        description: saleDescription(await tenantDisplayName(input.tenantId)),
        amountCents: totalCents,
      },
    ],
    expiresAt: null,
    metadata: {
      kind: 'merch',
      merch_id: item.id,
      client_id: input.clientId,
      // Frozen here rather than re-read at webhook time: this is the title the
      // member saw when they paid.
      merch_title: item.title,
      amount_sgd: (totalCents / 100).toFixed(2),
    },
  }
}

/**
 * Write the purchase. Idempotent on the payment intent — the webhook and the
 * confirmation page's sync-session both deliver the same session, and the second
 * one must not double-charge the history.
 */
export async function recordMerchOrder(input: {
  tenantId: string
  clientId: string
  merchId: string | null
  title: string
  amountSgd: string
  paymentIntentId: string | null
}): Promise<MerchOrderRow> {
  const [inserted] = await db
    .insert(merchOrders)
    .values({
      tenantId: input.tenantId,
      clientId: input.clientId,
      merchId: input.merchId,
      title: input.title,
      amountSgd: input.amountSgd,
      stripePaymentIntentId: input.paymentIntentId,
    })
    .onConflictDoNothing({ target: merchOrders.stripePaymentIntentId })
    .returning()
  if (inserted) return inserted

  const [existing] = await db
    .select()
    .from(merchOrders)
    .where(
      and(
        eq(merchOrders.tenantId, input.tenantId),
        eq(merchOrders.stripePaymentIntentId, input.paymentIntentId!),
      ),
    )
    .limit(1)
  return existing!
}

export async function listMerchOrders(
  tenantId: string,
  clientId: string,
): Promise<MerchOrderRow[]> {
  return db
    .select()
    .from(merchOrders)
    .where(and(eq(merchOrders.tenantId, tenantId), eq(merchOrders.clientId, clientId)))
    .orderBy(desc(merchOrders.createdAt))
}

export function serializeMerchOrder(row: MerchOrderRow) {
  return {
    id: row.id,
    merch_id: row.merchId,
    title: row.title,
    amount_sgd: row.amountSgd,
    purchased_at: row.createdAt,
  }
}
