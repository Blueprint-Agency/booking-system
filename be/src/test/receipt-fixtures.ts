import { randomUUID } from 'node:crypto'
import { inArray, sql } from 'drizzle-orm'
import type { PurchaseLine } from '../services/billing/purchase-lines'
import type { ReceiptRow } from '../services/receipts/issue'
import type { TestApp } from './harness'

/**
 * A Receipt issued for a member the one way any is (#380): a Purchase settled
 * as paid, its card payment banked, then `issueReceipt` inside the studio's
 * own transaction, as the webhook's paid class package calls it. For the
 * features that keep a studio's Receipts through something else happening —
 * a member's permanent deletion and export, a studio's archive and restore —
 * and so need one to exist, not to test issuing.
 *
 * Imported lazily: `db` reads the environment at module load, which
 * `startTestApp` has to finish writing first.
 */
export function receiptFixtures(harness: TestApp) {
  const purchaseIds: string[] = []

  /** A ten pack at S$150.00 less a S$15.00 code, paid by a Visa ending 4242. */
  const issueFor = async (tenantId: string, clientId: string): Promise<ReceiptRow> => {
    const lines: PurchaseLine[] = [
      {
        description: 'Ten pack',
        quantity: 1,
        listPriceSgd: '150.00',
        discountSgd: '15.00',
        discounts: [{ source: 'promo_code', id: null, label: 'TENOFF', amountSgd: '15.00' }],
        amountSgd: '135.00',
      },
    ]
    const [purchase] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO purchases (tenant_id, client_id, kind, total_sgd, amount_paid_sgd, status, lines, metadata, settled_at)
      VALUES (${tenantId}, ${clientId}, 'class_package', '135.00', '135.00', 'paid', ${JSON.stringify(lines)}::jsonb,
              ${JSON.stringify({ item_name: 'Ten pack' })}::jsonb, now())
      RETURNING id`)
    purchaseIds.push(purchase!.id)
    await harness.db.execute(sql`
      INSERT INTO stripe_payments (tenant_id, purchase_id, client_id, payment_intent_id, amount_sgd, kind, status, method, card_brand, card_last4)
      VALUES (${tenantId}, ${purchase!.id}, ${clientId}, ${`pi_receipt_fixture_${randomUUID().slice(0, 12)}`}, '135.00',
              'class_package', 'succeeded', 'card', 'visa', '4242')`)

    const { db, withTenant } = await import('../db')
    const { issueReceipt } = await import('../services/receipts/issue')
    const { receipt } = await withTenant(tenantId, () => issueReceipt(db, tenantId, purchase!.id))
    return receipt
  }

  /** The Receipts, payments and Purchases `issueFor` made, wherever they now are. */
  const cleanup = async () => {
    if (purchaseIds.length === 0) return
    const schema = await import('../db/schema')
    await harness.db.delete(schema.receipts).where(inArray(schema.receipts.purchaseId, purchaseIds))
    await harness.db.delete(schema.stripePayments).where(inArray(schema.stripePayments.purchaseId, purchaseIds))
    await harness.db.delete(schema.purchases).where(inArray(schema.purchases.id, purchaseIds))
  }

  return { issueFor, cleanup }
}
