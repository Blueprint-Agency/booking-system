import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { purchases, stripePayments } from '../../db/schema/ledger'

/**
 * A member's payments through the payment provider, newest first — the
 * "Payments" list on the portal's customer detail page.
 *
 * Only money that went through the provider has a row here. A package given
 * free, a $0 trial pass, and a package brought over from another system when a
 * studio migrated carry no payment: what was paid for those lives on the
 * package itself (`amount_paid_sgd`), and the page shows it there.
 */
export interface MemberPaymentView {
  id: string
  /** What the Purchase was for, frozen at checkout. */
  itemName: string
  kind: (typeof stripePayments.$inferSelect)['kind']
  amountSgd: string
  status: (typeof stripePayments.$inferSelect)['status']
  /** The sale it is part of: open (part-paid), paid, refunded, abandoned. */
  purchaseStatus: (typeof purchases.$inferSelect)['status']
  receiptUrl: string | null
  refundedAt: Date | null
  createdAt: Date
}

export const MEMBER_PAYMENTS_LIMIT = 50

export async function listMemberPayments(
  tenantId: string,
  clientId: string,
  limit = MEMBER_PAYMENTS_LIMIT,
): Promise<MemberPaymentView[]> {
  const rows = await db
    .select({
      id: stripePayments.id,
      kind: stripePayments.kind,
      amountSgd: stripePayments.amountSgd,
      status: stripePayments.status,
      receiptUrl: stripePayments.receiptUrl,
      refundedAt: stripePayments.refundedAt,
      createdAt: stripePayments.createdAt,
      metadata: purchases.metadata,
      purchaseStatus: purchases.status,
    })
    .from(stripePayments)
    .innerJoin(purchases, eq(purchases.id, stripePayments.purchaseId))
    .where(and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.clientId, clientId)))
    .orderBy(desc(stripePayments.createdAt))
    .limit(limit)

  return rows.map(r => ({
    id: r.id,
    itemName: (r.metadata as Record<string, string> | null)?.item_name || 'Purchase',
    kind: r.kind,
    amountSgd: r.amountSgd,
    status: r.status,
    purchaseStatus: r.purchaseStatus,
    receiptUrl: r.receiptUrl,
    refundedAt: r.refundedAt,
    createdAt: r.createdAt,
  }))
}
