/**
 * What a Receipt says, and in what order: **the one source** every place a
 * Receipt is shown draws from. The PDF (`pdf.ts`) and the HTML (`html.ts`,
 * which is the email's receipt block and, through the `html` on a Receipt,
 * the member's and the admin's Receipt pages) only lay this out; neither
 * words, formats or orders anything of its own, so they cannot drift apart.
 *
 * Laid out as a business receipt (#403), top to bottom:
 *
 * - the title, "Receipt", with the studio's logo on the right, or its
 *   Business name in the logo's place;
 * - the facts: Receipt number, Date paid (Issued on, where nothing was due),
 *   and Registration where the studio has a registration number;
 * - two columns: the studio (Business name, address, contact email) and
 *   **Bill to** (the Billing details the Purchase chose, its address a line
 *   each, and the member's email; or, where it chose none, the member's name
 *   and email; left out where the Receipt names nobody);
 * - the headline, `S$150.00 paid on 2 Oct 2026`, with a PAID or REFUNDED
 *   marker and `Refunded on …`; or "No payment: nothing was due.";
 * - the lines as a table, each at List Price × quantity, each discount under
 *   the line it came off;
 * - Subtotal, Discount when there was one, Total, and Amount paid;
 * - the Payment history: each payment's method, date and amount;
 * - the studio's note; the platform's credit.
 *
 * No tax and no invoice number: a Receipt has neither.
 *
 * `receiptDocument` is pure. Everything comes off the Receipt's own snapshot,
 * except the studio's logo (and the name its image stands for), which
 * `receiptStudio` reads as of now (`tenant_settings`).
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { tenantSettings } from '../../db/schema/tenancy'
import { sgFormat } from '../../lib/time'
import { sgdText, toCents } from '../../shared/money'
import { billToAddressLines } from '../billing-details/address'
import type { LineDiscount, PurchaseLine } from '../billing/purchase-lines'
import { cardBrandName, methodName } from '../finance/methods'
import type { ReceiptRow } from './issue'
import type { ReceiptPayment } from './snapshot'
import { PLATFORM_CREDIT } from './theme'

/** How the studio presents itself on its Receipts today. */
export interface ReceiptStudio {
  /** The name it shows members today: what its logo stands for, to a reader who cannot see it. */
  name: string
  /** The address of its logo, or null for the Business name alone. */
  logoUrl: string | null
}

/** A line in a block: the first of a block is set strong, the rest muted. */
export interface ReceiptBlockLine {
  text: string
  strong: boolean
}

export interface ReceiptDocument {
  /** "Receipt". */
  title: string
  /** `R-000123`. */
  number: string
  /**
   * Top right: the studio's logo, as of now, or its Business name, as issued,
   * in the logo's place. `name` is what the logo stands for.
   */
  brand: { logoUrl: string | null; name: string }
  /** The studio's Business name as issued: the seller. */
  sellerName: string
  /** Receipt number, Date paid or Issued on, and Registration when the studio has one. */
  facts: { label: string; value: string }[]
  /** The studio: Business name (strong), address a line each, contact email. */
  seller: ReceiptBlockLine[]
  /**
   * Bill to: the name (strong), the address a line each, the member's email.
   * Null where the Receipt names nobody (its member permanently deleted): the
   * block is left out rather than drawn empty.
   */
  billTo: { label: string; lines: ReceiptBlockLine[] } | null
  /** `S$150.00 paid on 2 Oct 2026`, or `No payment: nothing was due.` */
  headline: string
  /** PAID once paid, REFUNDED once refunded; none on a Receipt where nothing was due. */
  chip: { text: string; tone: 'paid' | 'refunded' } | null
  /** `Refunded on 5 Oct 2026`, or null. */
  refunded: string | null
  columns: { description: string; quantity: string; unitPrice: string; amount: string }
  lines: {
    description: string
    quantity: string
    unitPrice: string
    /** List Price × quantity, before anything was taken off. */
    amount: string
    discounts: { label: string; amount: string }[]
  }[]
  /** Subtotal, Discount when there was one, Total, and Amount paid, which is `strong`. */
  totals: { label: string; amount: string; strong: boolean }[]
  /** Every payment that paid it, or null where nothing was paid. */
  payments: {
    title: string
    columns: { method: string; date: string; amount: string }
    rows: { method: string; date: string; amount: string }[]
  } | null
  /** The studio's own footer note, as it wrote it. */
  note: string | null
  credit: typeof PLATFORM_CREDIT
}

const day = sgFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const money = (sgd: string): string => sgdText(toCents(sgd))
/** An amount taken off. A hyphen, not a minus sign: the PDF's standard fonts have no minus. */
const off = (sgd: string): string => `-${money(sgd)}`

/**
 * How a payment was made, on every Receipt: `Visa •••• 4242`,
 * `Apple Pay · Visa •••• 4242`, `PayNow`. The Receipt pages no longer word it
 * themselves: they frame the `html` drawn from this.
 */
export const paymentLabel = (p: ReceiptPayment): string => {
  if (p.method === 'card' || p.cardBrand) {
    const card = [p.cardBrand ? cardBrandName(p.cardBrand) : 'Card', p.cardLast4 ? `•••• ${p.cardLast4}` : null]
      .filter(Boolean)
      .join(' ')
    return p.wallet ? `${methodName(p.wallet)} · ${card}` : card
  }
  return p.method ? methodName(p.method) : 'Online payment'
}

/** A block of text a studio typed (its address), a line each. */
const textLines = (value: string | null): string[] =>
  (value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

/** How a discount reads under its line: a code alone would mean nothing on paper. */
const discountLabel = (d: LineDiscount): string => (d.source === 'promo_code' ? `Promo code ${d.label}` : d.label)

/** What a line came to before anything was taken off: its List Price times its quantity. */
const lineListTotal = (line: PurchaseLine): string => sgdText(toCents(line.listPriceSgd) * line.quantity)

/** The studio as it presents itself today: its display name (else the name on the Receipt) and its logo. */
export async function receiptStudio(receipt: Pick<ReceiptRow, 'tenantId' | 'sellerName'>): Promise<ReceiptStudio> {
  const [settings] = await db
    .select({ displayName: tenantSettings.displayName, logoUrl: tenantSettings.logoUrl })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, receipt.tenantId))
    .limit(1)
  return { name: settings?.displayName || receipt.sellerName, logoUrl: settings?.logoUrl || null }
}

/** The Receipt, worded and ordered, ready to lay out. Pure. */
export function receiptDocument(receipt: ReceiptRow, studio: ReceiptStudio): ReceiptDocument {
  const paid = receipt.payments.length > 0
  // The day the last payment, the one that settled it, was made; the day it
  // was issued where none was.
  const paidOn = paid ? day.format(new Date(receipt.payments.at(-1)!.paidAt)) : null
  // The name it trades under, as issued; a Receipt from before #398 that
  // carried none names the studio as it then called itself.
  const sellerName = receipt.sellerBusinessName?.trim() || receipt.sellerName

  const facts: ReceiptDocument['facts'] = [
    { label: 'Receipt number', value: receipt.displayNumber },
    paidOn ? { label: 'Date paid', value: paidOn } : { label: 'Issued on', value: day.format(receipt.issuedAt) },
  ]
  if (receipt.sellerRegistrationNumber?.trim()) facts.push({ label: 'Registration', value: receipt.sellerRegistrationNumber.trim() })

  const muted = (text: string): ReceiptBlockLine => ({ text, strong: false })
  const seller: ReceiptBlockLine[] = [
    { text: sellerName, strong: true },
    ...textLines(receipt.sellerAddress).map(muted),
    ...(receipt.sellerEmail ? [muted(receipt.sellerEmail)] : []),
  ]
  // Bill to the Billing details the Purchase chose (#401); where it chose
  // none, the member by their name and email.
  const billed: ReceiptBlockLine[] = receipt.billTo
    ? [{ text: receipt.billTo.name, strong: true }, ...billToAddressLines(receipt.billTo).map(muted)]
    : receipt.buyerName
      ? [{ text: receipt.buyerName, strong: true }]
      : []
  if (receipt.buyerEmail) billed.push({ text: receipt.buyerEmail, strong: billed.length === 0 })

  return {
    title: 'Receipt',
    number: receipt.displayNumber,
    brand: { logoUrl: studio.logoUrl, name: studio.logoUrl ? studio.name : sellerName },
    sellerName,
    facts,
    seller,
    billTo: billed.length > 0 ? { label: 'Bill to', lines: billed } : null,
    headline: paidOn ? `${money(receipt.totalSgd)} paid on ${paidOn}` : 'No payment: nothing was due.',
    chip: receipt.refundedAt ? { text: 'REFUNDED', tone: 'refunded' } : paid ? { text: 'PAID', tone: 'paid' } : null,
    refunded: receipt.refundedAt ? `Refunded on ${day.format(receipt.refundedAt)}` : null,
    columns: { description: 'Description', quantity: 'Qty', unitPrice: 'Unit price', amount: 'Amount' },
    lines: receipt.lines.map(line => ({
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: money(line.listPriceSgd),
      amount: lineListTotal(line),
      discounts: line.discounts.map(d => ({ label: discountLabel(d), amount: off(d.amountSgd) })),
    })),
    totals: [
      { label: 'Subtotal', amount: money(receipt.subtotalSgd), strong: false },
      ...(toCents(receipt.discountSgd) > 0 ? [{ label: 'Discount', amount: off(receipt.discountSgd), strong: false }] : []),
      { label: 'Total', amount: money(receipt.totalSgd), strong: false },
      { label: 'Amount paid', amount: money(receipt.totalSgd), strong: true },
    ],
    payments: paid
      ? {
          title: 'Payment history',
          columns: { method: 'Payment method', date: 'Date', amount: 'Amount paid' },
          rows: receipt.payments.map(p => ({ method: paymentLabel(p), date: day.format(new Date(p.paidAt)), amount: money(p.amountSgd) })),
        }
      : null,
    note: receipt.sellerFooter,
    credit: PLATFORM_CREDIT,
  }
}
