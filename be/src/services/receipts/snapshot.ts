/**
 * What a Receipt says, worked out from what the Purchase froze (#380).
 *
 * Pure: no database, so the figures a Receipt prints can be checked without
 * one. `issue.ts` reads the rows and writes what this returns.
 */
import { toCents, toSgd } from '../../shared/money'
import type { PurchaseLine } from '../billing/purchase-lines'

/** One payment as a Receipt prints it: how it was paid, how much, and when. */
export interface ReceiptPayment {
  /** The provider's payment method type: `card`, `paynow`, `grabpay`… */
  method: string | null
  cardBrand: string | null
  cardLast4: string | null
  /** A wallet the card was in: `apple_pay`, `google_pay`. */
  wallet: string | null
  amountSgd: string
  /** ISO 8601. */
  paidAt: string
}

/** The prefix every studio's Receipts carry until it sets its own (#391). */
export const DEFAULT_RECEIPT_PREFIX = 'R'

/** `R-000123`: the prefix and the sequence, zero-padded to six. */
export const displayNumber = (prefix: string, number: number): string =>
  `${prefix}-${String(number).padStart(6, '0')}`

/**
 * The lines a Receipt prints. A Purchase opened before its lines were frozen
 * (#382) has none, and gets one line for the whole sale under its name.
 */
export function receiptLines(lines: PurchaseLine[], itemName: string, totalSgd: string): PurchaseLine[] {
  if (lines.length > 0) return lines
  const total = toSgd(toCents(totalSgd))
  return [{ description: itemName, quantity: 1, listPriceSgd: total, discountSgd: '0.00', discounts: [], amountSgd: total }]
}

/**
 * What a Receipt was for, in one phrase, for a list: the first line names the
 * thing bought and the rest are extras beside it, the same phrase checkout
 * freezes as a Purchase's item name.
 */
export const receiptItem = (lines: PurchaseLine[]): string => {
  const first = lines[0]?.description ?? 'Purchase'
  return lines.length > 1 ? `${first} + ${lines.length - 1} more` : first
}

/** The totals under the lines: before anything was taken off, what was, and what was paid. */
export function receiptTotals(lines: PurchaseLine[], totalSgd: string) {
  const subtotal = lines.reduce((sum, l) => sum + toCents(l.listPriceSgd) * l.quantity, 0)
  const discount = lines.reduce((sum, l) => sum + toCents(l.discountSgd), 0)
  return { subtotalSgd: toSgd(subtotal), discountSgd: toSgd(discount), totalSgd: toSgd(toCents(totalSgd)) }
}
