import { and, eq } from 'drizzle-orm'

import { db } from '../../db'
import { purchases, stripePayments } from '../../db/schema/ledger'
import { receiptForPurchase, type ReceiptSummary } from '../receipts/read'
import { openPurchaseById, type OpenPurchaseView } from './open-purchases'

export type CheckoutOutcome =
  | { status: 'granted'; receipt: ReceiptSummary | null }
  | { status: 'owing'; purchase: OpenPurchaseView }
  | { status: 'refunded' | 'abandoned' | 'pending' }

export async function checkoutOutcome(
  tenantId: string,
  clientId: string,
  session: { purchaseId: string | undefined; paymentIntentId: string | null },
): Promise<CheckoutOutcome> {
  const purchaseId = session.purchaseId ?? (await purchaseOfPayment(tenantId, session.paymentIntentId))
  if (!purchaseId) return { status: 'pending' }
  const [row] = await db
    .select({ status: purchases.status })
    .from(purchases)
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.clientId, clientId), eq(purchases.id, purchaseId)))
    .limit(1)
  switch (row?.status) {
    case 'paid':
      return { status: 'granted', receipt: await receiptForPurchase(tenantId, clientId, purchaseId) }
    case 'refunded':
    case 'abandoned':
      return { status: row.status }
    case 'open': {
      const owing = await openPurchaseById(tenantId, clientId, purchaseId)
      return owing ? { status: 'owing', purchase: owing } : { status: 'pending' }
    }
    case undefined:
      return { status: 'pending' }
  }
}

async function purchaseOfPayment(tenantId: string, paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null
  const [row] = await db
    .select({ purchaseId: stripePayments.purchaseId })
    .from(stripePayments)
    .where(and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.paymentIntentId, paymentIntentId)))
    .limit(1)
  return row?.purchaseId ?? null
}
