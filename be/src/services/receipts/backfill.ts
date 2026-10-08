/**
 * Receipts for the sales made before Receipts existed (#394). Run once per
 * environment by `backfill-cli.ts`, inside each studio's Tenant context.
 *
 * Every Purchase paid in full here with no Receipt — paid, or paid and since
 * refunded — gets one through `issueReceipt`, the one way anything writes a
 * Receipt, in the order the sales were paid (`settled_at`, or `created_at` on
 * rows too old to have stamped it). So the numbers continue the studio's
 * sequence after any already issued, and on a studio with none its earliest
 * sale is number 1. Each is dated when its sale was paid. A Purchase opened
 * before lines were frozen (#382) gets one line for the whole sale, under its
 * item name, from `receiptLines`. A refunded one is stamped refunded on the
 * day the last of its money went back.
 *
 * Not a migrated Purchase (`source_sale_id`): it was sold before the studio
 * came to the platform and had its receipt in the old system. Not an Open or
 * an Abandoned one: no sale was completed.
 *
 * Nothing is sent: the member's email goes out from a live settlement, never
 * from here.
 */
import { and, asc, eq, inArray, isNull, max, notExists, sql } from 'drizzle-orm'
import { db } from '../../db'
import { purchases, receipts, stripePayments } from '../../db/schema/ledger'
import { issueReceipt, stampReceiptRefunded } from './issue'

export interface BackfillResult {
  /** Receipts this run issued. */
  issued: number
  /** Of those, the ones stamped refunded. */
  refunded: number
}

/** When the last of a refunded Purchase's money went back to the member. */
async function refundedOn(tenantId: string, purchaseId: string, fallback: Date | null): Promise<Date | undefined> {
  const [row] = await db
    .select({ at: max(stripePayments.refundedAt) })
    .from(stripePayments)
    .where(and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.purchaseId, purchaseId)))
  const at = row?.at ?? fallback
  // No date recorded anywhere: the stamp is dated by this run, the day it is
  // known to be refunded, rather than left saying the money is still held.
  return at ? new Date(at) : undefined
}

/**
 * Issue the studio's missing Receipts. Must run inside `withTenant(tenantId)`:
 * the reads and writes are one transaction, so the studio is backfilled whole
 * or not at all, and its counter is held until it commits.
 */
export async function backfillStudioReceipts(tenantId: string): Promise<BackfillResult> {
  const paidAt = sql<Date>`coalesce(${purchases.settledAt}, ${purchases.createdAt})`
  const owed = await db
    .select({ id: purchases.id, status: purchases.status, paidAt: sql<string>`${paidAt}`, refundedAt: purchases.refundedAt })
    .from(purchases)
    .where(
      and(
        eq(purchases.tenantId, tenantId),
        inArray(purchases.status, ['paid', 'refunded']),
        isNull(purchases.sourceSaleId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(receipts)
            .where(and(eq(receipts.tenantId, purchases.tenantId), eq(receipts.purchaseId, purchases.id))),
        ),
      ),
    )
    .orderBy(asc(paidAt), asc(purchases.createdAt), asc(purchases.id))

  const result: BackfillResult = { issued: 0, refunded: 0 }
  for (const purchase of owed) {
    const { issued } = await issueReceipt(db, tenantId, purchase.id, { issuedAt: new Date(purchase.paidAt) })
    if (!issued) continue
    result.issued += 1
    if (purchase.status === 'refunded') {
      await stampReceiptRefunded(db, tenantId, purchase.id, await refundedOn(tenantId, purchase.id, purchase.refundedAt))
      result.refunded += 1
    }
  }
  return result
}
