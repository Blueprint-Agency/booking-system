import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { purchases, receipts, stripePayments } from '../../db/schema/ledger'
import { refundInFlight } from './balance'

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
  /**
   * The studio's Receipt for the Purchase this paid towards (#389): null until
   * the Purchase is paid in full, and for a sale made before Receipts existed.
   */
  receiptId: string | null
  /** The provider's own receipt for this one charge. Kept for now; the portal links to `receiptId`. */
  receiptUrl: string | null
  refundedAt: Date | null
  /**
   * A Refund has been asked of the provider and has not landed (#275). The
   * status still says `succeeded` until `charge.refunded` arrives, and a row
   * reading "Paid" beside a Refund the admin has just issued reads as a failure.
   */
  refundProcessing: boolean
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
      refundRequestedAt: stripePayments.refundRequestedAt,
      createdAt: stripePayments.createdAt,
      metadata: purchases.metadata,
      purchaseStatus: purchases.status,
      receiptId: receipts.id,
    })
    .from(stripePayments)
    .innerJoin(purchases, eq(purchases.id, stripePayments.purchaseId))
    .leftJoin(receipts, and(eq(receipts.tenantId, stripePayments.tenantId), eq(receipts.purchaseId, purchases.id)))
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
    receiptId: r.receiptId,
    receiptUrl: r.receiptUrl,
    refundedAt: r.refundedAt,
    refundProcessing:
      refundInFlight(r.refundRequestedAt) && (r.status === 'succeeded' || r.status === 'pending'),
    createdAt: r.createdAt,
  }))
}
