/**
 * What a Receipt says, and in what order: **the one source** every place a
 * Receipt is shown draws from. The PDF (`pdf.ts`) and the HTML (`html.ts`,
 * which is the email's receipt block and, through the `html` on a Receipt,
 * the member's and the admin's Receipt pages) only lay this out; neither
 * words, formats or orders anything of its own, so they cannot drift apart.
 *
 * Top to bottom: the studio beside the number; the amount paid, with a PAID
 * or REFUNDED chip and one sentence on how it was paid; Issued to, Issued on
 * and Paid with; the lines as a table (each at List Price × quantity, each
 * discount under the line it came off); Subtotal, Discount, Total paid; the
 * studio's note; the platform's credit.
 *
 * `receiptDocument` is pure. Everything comes off the Receipt's own snapshot,
 * except the studio's display name and logo, which `receiptStudio` reads as of
 * now (`tenant_settings`).
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { tenantSettings } from '../../db/schema/tenancy'
import { sgFormat } from '../../lib/time'
import { sgdText, toCents } from '../../shared/money'
import type { LineDiscount, PurchaseLine } from '../billing/purchase-lines'
import { cardBrandName, methodName } from '../finance/methods'
import type { ReceiptRow } from './issue'
import type { ReceiptPayment } from './snapshot'
import { PLATFORM_CREDIT } from './theme'

/** How the studio presents itself on its Receipts today. */
export interface ReceiptStudio {
  name: string
  /** The address of its logo, or null for the name alone. */
  logoUrl: string | null
}

/** A value under a label: the first of a group is set strong, the rest muted. */
export interface ReceiptFactLine {
  text: string
  strong: boolean
}

export interface ReceiptDocument {
  /** `R-000123`. */
  number: string
  studio: ReceiptStudio & {
    /** Legal name, registration number and address, those the studio has set. */
    details: string[]
  }
  /** `S$150.00`: the total paid, the figure the panel leads with. */
  amountPaid: string
  /** PAID once paid, REFUNDED once refunded; none on a Receipt where nothing was due. */
  chip: { text: string; tone: 'paid' | 'refunded' } | null
  /** One sentence on how it was paid: `Paid by Visa •••• 4242 on 1 Oct 2026`. */
  status: string
  /** `Refunded on 5 Oct 2026`, or null. */
  refunded: string | null
  facts: { key: 'issuedTo' | 'issuedOn' | 'paidWith'; label: string; lines: ReceiptFactLine[] }[]
  columns: { description: string; quantity: string; unitPrice: string; amount: string }
  lines: {
    description: string
    quantity: string
    unitPrice: string
    /** List Price × quantity, before anything was taken off. */
    amount: string
    discounts: { label: string; amount: string }[]
  }[]
  /** Subtotal, Discount when there was one, and Total paid, which is `grand`. */
  totals: { label: string; amount: string; grand: boolean }[]
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

/** How a discount reads under its line: a code alone would mean nothing on paper. */
const discountLabel = (d: LineDiscount): string => (d.source === 'promo_code' ? `Promo code ${d.label}` : d.label)

/** What a line came to before anything was taken off: its List Price times its quantity. */
const lineListTotal = (line: PurchaseLine): string => sgdText(toCents(line.listPriceSgd) * line.quantity)

function statusSentence(payments: ReceiptPayment[]): string {
  if (payments.length === 0) return 'No payment: nothing was due.'
  if (payments.length === 1) return `Paid by ${paymentLabel(payments[0]!)} on ${day.format(new Date(payments[0]!.paidAt))}`
  return `Paid in ${payments.length} payments`
}

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
  const refunded = receipt.refundedAt !== null
  const facts: ReceiptDocument['facts'] = []
  if (receipt.buyerName || receipt.buyerEmail) {
    facts.push({
      key: 'issuedTo',
      label: 'Issued to',
      lines: [
        ...(receipt.buyerName ? [{ text: receipt.buyerName, strong: true }] : []),
        ...(receipt.buyerEmail ? [{ text: receipt.buyerEmail, strong: !receipt.buyerName }] : []),
      ],
    })
  }
  facts.push({ key: 'issuedOn', label: 'Issued on', lines: [{ text: day.format(receipt.issuedAt), strong: true }] })
  if (receipt.payments.length > 0) {
    facts.push({
      key: 'paidWith',
      label: 'Paid with',
      lines: receipt.payments.flatMap(p => [
        { text: paymentLabel(p), strong: true },
        { text: `${day.format(new Date(p.paidAt))} · ${money(p.amountSgd)}`, strong: false },
      ]),
    })
  }

  return {
    number: receipt.displayNumber,
    studio: {
      ...studio,
      details: [receipt.sellerLegalName, receipt.sellerRegistrationNumber, receipt.sellerAddress].filter(
        (d): d is string => Boolean(d),
      ),
    },
    amountPaid: money(receipt.totalSgd),
    chip: refunded
      ? { text: 'REFUNDED', tone: 'refunded' }
      : receipt.payments.length > 0
        ? { text: 'PAID', tone: 'paid' }
        : null,
    status: statusSentence(receipt.payments),
    refunded: receipt.refundedAt ? `Refunded on ${day.format(receipt.refundedAt)}` : null,
    facts,
    columns: { description: 'Description', quantity: 'Qty', unitPrice: 'Unit price', amount: 'Amount' },
    lines: receipt.lines.map(line => ({
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: money(line.listPriceSgd),
      amount: lineListTotal(line),
      discounts: line.discounts.map(d => ({ label: discountLabel(d), amount: off(d.amountSgd) })),
    })),
    totals: [
      { label: 'Subtotal', amount: money(receipt.subtotalSgd), grand: false },
      ...(toCents(receipt.discountSgd) > 0 ? [{ label: 'Discount', amount: off(receipt.discountSgd), grand: false }] : []),
      { label: 'Total paid', amount: money(receipt.totalSgd), grand: true },
    ],
    note: receipt.sellerFooter,
    credit: PLATFORM_CREDIT,
  }
}
