/**
 * Issuing a Receipt (#380). **The one way anything writes to `receipts`.**
 *
 * Called inside the transaction that settles a Purchase, wherever settlement
 * happens — today the webhook's paid class package (#384); every other settle
 * path, the Refund stamp and the backfill reach it the same way. Settling and
 * issuing commit or roll back together: a delivery that fails leaves no
 * Receipt and hands its number back.
 *
 * Idempotent per Purchase. A webhook redelivery, or the confirmation page's
 * fallback racing the webhook, gets back the Receipt the first one issued —
 * with `issued: false`, so whoever sends the member's email (#387) sends it
 * from the delivery that issued it and from no other.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { purchases, receiptCounters, receipts, stripePayments } from '../../db/schema/ledger'
import { tenants, tenantSettings } from '../../db/schema/tenancy'
import type { PurchaseLine } from '../billing/purchase-lines'
import { DEFAULT_RECEIPT_PREFIX, displayNumber, receiptLines, receiptTotals, type ReceiptPayment } from './snapshot'

/** A handle that can read and write: the transaction the Purchase settles in. */
export type ReceiptTx = Pick<typeof db, 'select' | 'insert' | 'update'>

export type ReceiptRow = typeof receipts.$inferSelect

/** A Purchase that can carry a Receipt: one paid in full, or since refunded. */
const RECEIPTED = new Set(['paid', 'refunded'])

async function existingReceipt(tx: ReceiptTx, tenantId: string, purchaseId: string): Promise<ReceiptRow | null> {
  const [row] = await tx
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.purchaseId, purchaseId)))
    .limit(1)
  return row ?? null
}

/**
 * Issue the Purchase's Receipt, or hand back the one it already has.
 *
 * Takes the studio's next number under a row lock on its counter, then writes
 * the snapshot: the studio's display name and receipt details (numbered under
 * its prefix as it stands now), the member's name and email, the
 * Purchase's lines and totals, and its payments as they stand in `tx`. Nothing
 * on it is ever recomputed.
 *
 * The Purchase must be settled in `tx` already, and its settling payment
 * banked, so the payment it prints is the one that paid.
 */
export async function issueReceipt(
  tx: ReceiptTx,
  tenantId: string,
  purchaseId: string,
): Promise<{ receipt: ReceiptRow; issued: boolean }> {
  const already = await existingReceipt(tx, tenantId, purchaseId)
  if (already) return { receipt: already, issued: false }

  const [purchase] = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, purchaseId)))
    .limit(1)
  // Invariant: only a settle path calls this, and only for a Purchase it found in this Tenant.
  if (!purchase) throw new Error(`issueReceipt: no purchase ${purchaseId} in tenant ${tenantId}`)
  // Invariant: a Receipt stands for a completed sale; an open or abandoned one is a caller's bug.
  if (!RECEIPTED.has(purchase.status)) {
    throw new Error(`issueReceipt: purchase ${purchaseId} is ${purchase.status}, not paid`)
  }

  // The studio's counter, made on its first Receipt. A second transaction
  // making it at the same moment waits here for the first to commit.
  await tx.insert(receiptCounters).values({ tenantId }).onConflictDoNothing()
  const [counter] = await tx
    .select({ nextNumber: receiptCounters.nextNumber })
    .from(receiptCounters)
    .where(eq(receiptCounters.tenantId, tenantId))
    .for('update')

  // Asked again under the lock. A delivery that raced this one and won has
  // committed by now, and its Receipt is the Receipt: taking a number here
  // as well would leave a gap where this one's insert failed.
  const raced = await existingReceipt(tx, tenantId, purchaseId)
  if (raced) return { receipt: raced, issued: false }

  // The studio's receipt details as they stand now (#391): copied on, so a
  // later edit or prefix change reaches only the Receipts issued after it.
  const [seller] = await tx
    .select({
      name: tenants.name,
      displayName: tenantSettings.displayName,
      prefix: tenantSettings.receiptPrefix,
      legalName: tenantSettings.receiptLegalName,
      registrationNumber: tenantSettings.receiptRegistrationNumber,
      address: tenantSettings.receiptAddress,
      footer: tenantSettings.receiptFooter,
    })
    .from(tenants)
    .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId))
    .limit(1)

  const [buyer] = purchase.clientId
    ? await tx
        .select({ name: clients.name, email: clients.email })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(clients.id, purchase.clientId)))
        .limit(1)
    : []

  const paid = await tx
    .select({
      method: stripePayments.method,
      cardBrand: stripePayments.cardBrand,
      cardLast4: stripePayments.cardLast4,
      wallet: stripePayments.wallet,
      amountSgd: stripePayments.amountSgd,
      createdAt: stripePayments.createdAt,
    })
    .from(stripePayments)
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        eq(stripePayments.purchaseId, purchaseId),
        inArray(stripePayments.status, ['succeeded', 'refunded']),
      ),
    )
    .orderBy(asc(stripePayments.createdAt))
  const payments: ReceiptPayment[] = paid.map(p => ({
    method: p.method,
    cardBrand: p.cardBrand,
    cardLast4: p.cardLast4,
    wallet: p.wallet,
    amountSgd: p.amountSgd,
    paidAt: p.createdAt.toISOString(),
  }))

  const itemName = (purchase.metadata as Record<string, string> | null)?.item_name || 'Purchase'
  const lines: PurchaseLine[] = receiptLines(purchase.lines, itemName, purchase.totalSgd)
  const number = counter!.nextNumber

  await tx
    .update(receiptCounters)
    .set({ nextNumber: sql`${receiptCounters.nextNumber} + 1` })
    .where(eq(receiptCounters.tenantId, tenantId))

  const [receipt] = await tx
    .insert(receipts)
    .values({
      tenantId,
      purchaseId,
      clientId: purchase.clientId,
      number,
      displayNumber: displayNumber(seller!.prefix || DEFAULT_RECEIPT_PREFIX, number),
      // What the studio calls itself to members, as of now.
      sellerName: seller!.displayName || seller!.name,
      sellerLegalName: seller!.legalName,
      sellerRegistrationNumber: seller!.registrationNumber,
      sellerAddress: seller!.address,
      sellerFooter: seller!.footer,
      buyerName: buyer?.name ?? null,
      buyerEmail: buyer?.email ?? null,
      kind: purchase.kind,
      lines,
      ...receiptTotals(lines, purchase.totalSgd),
      payments,
    })
    .returning()
  return { receipt: receipt!, issued: true }
}
