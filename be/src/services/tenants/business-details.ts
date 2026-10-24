/**
 * A studio's Business details (#391, #398): the Business name it trades under,
 * and what its Receipts print beside it — registration number, address, a
 * footer note — with the prefix its Receipt numbers carry. Beside them its
 * Display name, the everyday name its apps and emails call it by, where the
 * Business name is the formal one its Receipts and card charges carry.
 *
 * Rows the studio owns, in `tenant_settings`, set by its admin in the portal or
 * by the super portal when the studio is created. `issueReceipt` copies them
 * onto each Receipt as it is issued, so saving them here changes only the
 * Receipts issued afterwards: nothing already issued is ever rewritten.
 */
import { eq } from 'drizzle-orm'
import { afterCommit, db } from '../../db'
import { receiptCounters } from '../../db/schema/ledger'
import { tenants, tenantSettings } from '../../db/schema/tenancy'
import { BadRequestError } from '../../shared/errors'
import { DEFAULT_RECEIPT_PREFIX, displayNumber } from '../receipts/snapshot'
import { forgetCachedMailIdentity } from './mail-identity'
import { forgetCachedTenants } from './tenants'

export interface BusinessDetails {
  businessName: string
  displayName: string
  prefix: string
  registrationNumber: string | null
  address: string | null
  footer: string | null
}

/**
 * What an admin or the operator sends. Absent or blank is "none"; a blank
 * prefix is the default. The Display name alone is different: blank is refused,
 * and absent leaves the one the studio has, so a client from before it existed
 * does not have to know it.
 */
export type BusinessDetailsInput = { [K in keyof BusinessDetails]?: string | null }

/** Cleaned details, the Display name left out when none was sent. */
type CleanBusinessDetails = Omit<BusinessDetails, 'displayName'> & { displayName?: string }

/** The details with the number the studio's next Receipt will take under them. */
export interface BusinessDetailsView {
  details: BusinessDetails
  /** `R-000124`: the prefix as saved and the studio's next sequence number. */
  nextNumber: string
  /** `124`: the sequence alone, for a form previewing a prefix not yet saved. */
  nextSequence: number
}

/** The most a Business name may hold: it heads a Receipt and signs an email. */
const BUSINESS_NAME_MAX = 200

/**
 * Letters and digits, hyphens only between them, up to ten: it heads a number
 * read out over the phone and names the PDF file, so nothing that needs
 * escaping in either.
 */
const PREFIX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,8}[A-Za-z0-9])?$/

/** Each optional free-text detail, what an admin calls it, and the most it may hold. */
const TEXT_LIMITS = {
  registrationNumber: ['The registration number', 50],
  address: ['The address', 500],
  footer: ['The footer note', 1000],
} as const

const refuse = (message: string): never => {
  throw new BadRequestError('invalid_request', { message })
}

const tidy = (value: string | null | undefined): string => value?.replace(/\r\n?/g, '\n').trim() ?? ''

/**
 * A Business name as it is stored: trimmed, never blank, at most 200
 * characters. Refuses with one sentence an admin can read.
 */
function cleanBusinessName(input: string | null | undefined): string {
  const name = tidy(input)
  if (!name) refuse('A business name is required.')
  if (name.length > BUSINESS_NAME_MAX) refuse(`The business name is at most ${BUSINESS_NAME_MAX} characters.`)
  return name
}

/** A Display name as it is stored: the same rule as the Business name, in its own words. */
function cleanDisplayName(input: string | null | undefined): string {
  const name = tidy(input)
  if (!name) refuse('A display name is required.')
  if (name.length > BUSINESS_NAME_MAX) refuse(`The display name is at most ${BUSINESS_NAME_MAX} characters.`)
  return name
}

/**
 * The details as they are stored: trimmed, blanks as null, the Business name
 * required, a Display name when one was sent, and the prefix checked. Refuses
 * with one sentence an admin can read.
 */
export function cleanBusinessDetails(input: BusinessDetailsInput): CleanBusinessDetails {
  const prefix = input.prefix?.trim() || DEFAULT_RECEIPT_PREFIX
  if (!PREFIX.test(prefix)) {
    refuse('A receipt prefix is up to 10 letters or digits, with hyphens only between them.')
  }
  const text = (key: keyof typeof TEXT_LIMITS): string | null => {
    const value = tidy(input[key])
    if (!value) return null
    const [what, max] = TEXT_LIMITS[key]
    if (value.length > max) refuse(`${what} is at most ${max} characters.`)
    return value
  }
  const registrationNumber = text('registrationNumber')
  const address = text('address')
  const footer = text('footer')
  return {
    businessName: cleanBusinessName(input.businessName),
    ...(input.displayName !== undefined ? { displayName: cleanDisplayName(input.displayName) } : {}),
    prefix,
    registrationNumber,
    address,
    footer,
  }
}

/** The columns `cleanBusinessDetails` fills, ready to write to `tenant_settings`. */
export const businessDetailColumns = (details: CleanBusinessDetails) => ({
  businessName: details.businessName,
  ...(details.displayName !== undefined ? { displayName: details.displayName } : {}),
  receiptPrefix: details.prefix,
  receiptRegistrationNumber: details.registrationNumber,
  receiptAddress: details.address,
  receiptFooter: details.footer,
})

/** The studio's Business details, and the number its next Receipt will take. Inside the studio's context. */
export async function readBusinessDetails(tenantId: string): Promise<BusinessDetailsView> {
  const [row] = await db
    .select({
      domainName: tenants.name,
      businessName: tenantSettings.businessName,
      displayName: tenantSettings.displayName,
      prefix: tenantSettings.receiptPrefix,
      registrationNumber: tenantSettings.receiptRegistrationNumber,
      address: tenantSettings.receiptAddress,
      footer: tenantSettings.receiptFooter,
    })
    .from(tenants)
    .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId))
    .limit(1)
  // A studio with no settings row yet trades under its Domain name, as the
  // row the first save writes would say.
  const details: BusinessDetails = {
    businessName: row?.businessName ?? row?.domainName ?? '',
    // Its apps fall back the same way (fe-*/src/lib/brand.ts).
    displayName: row?.displayName?.trim() || row?.domainName || '',
    prefix: row?.prefix ?? DEFAULT_RECEIPT_PREFIX,
    registrationNumber: row?.registrationNumber ?? null,
    address: row?.address ?? null,
    footer: row?.footer ?? null,
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

/** Replace the studio's Business details. Receipts already issued keep what they were issued with. */
export async function saveBusinessDetails(tenantId: string, input: BusinessDetailsInput): Promise<BusinessDetailsView> {
  const columns = { ...businessDetailColumns(cleanBusinessDetails(input)), updatedAt: new Date() }
  await db
    .insert(tenantSettings)
    .values({ tenantId, ...columns })
    .onConflictDoUpdate({ target: tenantSettings.tenantId, set: columns })
  // The Display name signs every email and the Business name names the studio
  // on each card charge (#400), so the next one must not wait out the
  // identity's cache; nor must the apps, which read the Display name through
  // the tenant lookup. Once committed: forgotten any sooner, a send racing this
  // save could read the old name and cache it again for another minute.
  afterCommit(() => {
    forgetCachedMailIdentity(tenantId)
    forgetCachedTenants()
  })
  return readBusinessDetails(tenantId)
}
