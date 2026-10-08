/**
 * A studio's receipt details (#391): the prefix its Receipt numbers carry and
 * the business details its Receipts print — legal name, registration number,
 * address and a footer note.
 *
 * Rows the studio owns, in `tenant_settings`, set by its admin in the portal or
 * by the super portal when the studio is created. `issueReceipt` copies them
 * onto each Receipt as it is issued, so saving them here changes only the
 * Receipts issued afterwards: nothing already issued is ever rewritten.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { receiptCounters } from '../../db/schema/ledger'
import { tenantSettings } from '../../db/schema/tenancy'
import { BadRequestError } from '../../shared/errors'
import { DEFAULT_RECEIPT_PREFIX, displayNumber } from './snapshot'

export interface ReceiptDetails {
  prefix: string
  legalName: string | null
  registrationNumber: string | null
  address: string | null
  footer: string | null
}

/** What an admin or the operator sends. Absent or blank is "none"; a blank prefix is the default. */
export type ReceiptDetailsInput = { [K in keyof ReceiptDetails]?: string | null }

/** The details with the number the studio's next Receipt will take under them. */
export interface ReceiptDetailsView {
  details: ReceiptDetails
  /** `R-000124`: the prefix as saved and the studio's next sequence number. */
  nextNumber: string
  /** `124`: the sequence alone, for a form previewing a prefix not yet saved. */
  nextSequence: number
}

/**
 * Letters and digits, hyphens only between them, up to ten: it heads a number
 * read out over the phone and names the PDF file, so nothing that needs
 * escaping in either.
 */
const PREFIX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,8}[A-Za-z0-9])?$/

/** Each free-text detail, what an admin calls it, and the most it may hold. */
const TEXT_LIMITS = {
  legalName: ['The legal name', 200],
  registrationNumber: ['The registration number', 50],
  address: ['The address', 500],
  footer: ['The footer note', 1000],
} as const

const refuse = (message: string): never => {
  throw new BadRequestError('invalid_request', { message })
}

/**
 * The details as they are stored: trimmed, blanks as null, the prefix checked.
 * Refuses with one sentence an admin can read.
 */
export function cleanReceiptDetails(input: ReceiptDetailsInput): ReceiptDetails {
  const prefix = input.prefix?.trim() || DEFAULT_RECEIPT_PREFIX
  if (!PREFIX.test(prefix)) {
    refuse('A receipt prefix is up to 10 letters or digits, with hyphens only between them.')
  }
  const text = (key: keyof typeof TEXT_LIMITS): string | null => {
    const value = input[key]?.replace(/\r\n?/g, '\n').trim()
    if (!value) return null
    const [what, max] = TEXT_LIMITS[key]
    if (value.length > max) refuse(`${what} is at most ${max} characters.`)
    return value
  }
  return {
    prefix,
    legalName: text('legalName'),
    registrationNumber: text('registrationNumber'),
    address: text('address'),
    footer: text('footer'),
  }
}

/** The columns `cleanReceiptDetails` fills, ready to write to `tenant_settings`. */
export const receiptDetailColumns = (details: ReceiptDetails) => ({
  receiptPrefix: details.prefix,
  receiptLegalName: details.legalName,
  receiptRegistrationNumber: details.registrationNumber,
  receiptAddress: details.address,
  receiptFooter: details.footer,
})

/** The studio's receipt details, and the number its next Receipt will take. Inside the studio's context. */
export async function readReceiptDetails(tenantId: string): Promise<ReceiptDetailsView> {
  const [row] = await db
    .select({
      prefix: tenantSettings.receiptPrefix,
      legalName: tenantSettings.receiptLegalName,
      registrationNumber: tenantSettings.receiptRegistrationNumber,
      address: tenantSettings.receiptAddress,
      footer: tenantSettings.receiptFooter,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
  const details: ReceiptDetails = row ?? {
    prefix: DEFAULT_RECEIPT_PREFIX,
    legalName: null,
    registrationNumber: null,
    address: null,
    footer: null,
  }
  // No counter until the studio's first Receipt, which is number 1.
  const [counter] = await db
    .select({ nextNumber: receiptCounters.nextNumber })
    .from(receiptCounters)
    .where(eq(receiptCounters.tenantId, tenantId))
    .limit(1)
  const nextSequence = counter?.nextNumber ?? 1
  return { details, nextNumber: displayNumber(details.prefix, nextSequence), nextSequence }
}

/** Replace the studio's receipt details. Receipts already issued keep what they were issued with. */
export async function saveReceiptDetails(tenantId: string, input: ReceiptDetailsInput): Promise<ReceiptDetailsView> {
  const columns = { ...receiptDetailColumns(cleanReceiptDetails(input)), updatedAt: new Date() }
  await db
    .insert(tenantSettings)
    .values({ tenantId, ...columns })
    .onConflictDoUpdate({ target: tenantSettings.tenantId, set: columns })
  return readReceiptDetails(tenantId)
}
