/**
 * A member's Billing details (#399): the name-and-address sets a Purchase is
 * billed to — their own name, or a company's — kept at one studio, as their
 * login is (`docs/adr/0006-per-studio-logins.md`).
 *
 * - **At most three** per member. Held here, under a lock on the member's own
 *   `clients` row, so two adds racing each other cannot both see two and make
 *   four. The lock is on the member rather than on their sets because a member
 *   with none has no set to lock.
 * - **One default** while they have any. The first set added becomes it; making
 *   another the default unsets the old one; deleting the default hands it to
 *   the most recently added set left. The partial unique index on the table is
 *   the backstop: there is never more than one.
 * - **Only ever the member's own.** Every read and write names the Tenant, the
 *   member and the set, so another member's set — at this studio or another —
 *   is `404 billing_details_not_found`, never a hint that it exists.
 *
 * A Purchase copies the set it is billed to (`purchases.bill_to`), so editing
 * or deleting one never changes anything already bought; deleting is a hard
 * delete for that reason.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clientBillingDetails, clients } from '../../db/schema/identity'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

/** The most sets a member may keep at a studio. */
export const BILLING_DETAILS_LIMIT = 3

/** The country a set is in when the member does not say. */
export const DEFAULT_BILLING_COUNTRY = 'SG'

export type BillingDetails = typeof clientBillingDetails.$inferSelect

/** The address fields of a set, as stored and as a Purchase copies them. */
export interface BillingAddress {
  name: string
  line1: string
  line2: string | null
  city: string
  state: string | null
  postcode: string
  /** ISO 3166-1 alpha-2. */
  country: string
}

/**
 * What a member sends. On add, the required fields must be there; on edit, a
 * field left out keeps its value, and an optional one sent blank or null is
 * cleared. Country left out on add is Singapore.
 */
export type BillingDetailsInput = {
  name?: string
  line1?: string
  line2?: string | null
  city?: string
  state?: string | null
  postcode?: string
  country?: string
}

/** Each text field, what a member calls it, the most it may hold, and whether it must be there. */
const FIELDS = {
  name: { what: 'A name', max: 200, required: true },
  line1: { what: 'Address line 1', max: 200, required: true },
  line2: { what: 'Address line 2', max: 200, required: false },
  city: { what: 'A city', max: 100, required: true },
  state: { what: 'A state', max: 100, required: false },
  postcode: { what: 'A postcode', max: 20, required: true },
} as const

type TextField = keyof typeof FIELDS

const refuse = (message: string): never => {
  throw new BadRequestError('invalid_request', { message })
}

const notFound = () => new NotFoundError('billing_details_not_found')

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })

/** The codes ISO 3166 leaves to private use (`ZZ` is CLDR's "Unknown Region"): never a country. */
const PRIVATE_USE = /^(AA|Q[M-Z]|X[A-Z]|ZZ)$/

/** The country as stored: two letters, upper case, and one ISO 3166 names. */
function cleanCountry(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || PRIVATE_USE.test(code) || !REGIONS.of(code)) {
    refuse('A country is its two-letter code, such as SG for Singapore.')
  }
  return code
}

/**
 * The fields `input` sets, trimmed, blanks as null, each checked. With
 * `complete`, every required field must be present (an add); without, only
 * those sent are checked (an edit).
 */
function cleaned(input: BillingDetailsInput, complete: boolean): Partial<BillingAddress> {
  const out: Partial<Record<TextField, string | null>> & { country?: string } = {}
  for (const key of Object.keys(FIELDS) as TextField[]) {
    const { what, max, required } = FIELDS[key]
    const raw = input[key]
    if (raw === undefined && !complete) continue
    const value = raw?.trim() || null
    if (!value) {
      if (required) refuse(`${what} is required.`)
      out[key] = null
      continue
    }
    if (value.length > max) refuse(`${what} is at most ${max} characters.`)
    out[key] = value
  }
  if (input.country !== undefined) out.country = cleanCountry(input.country)
  else if (complete) out.country = DEFAULT_BILLING_COUNTRY
  return out as Partial<BillingAddress>
}

/** The member's sets, oldest first. */
export async function listBillingDetails(tenantId: string, clientId: string): Promise<BillingDetails[]> {
  return db
    .select()
    .from(clientBillingDetails)
    .where(and(eq(clientBillingDetails.tenantId, tenantId), eq(clientBillingDetails.clientId, clientId)))
    .orderBy(asc(clientBillingDetails.createdAt), asc(clientBillingDetails.id))
}

/**
 * One of the member's own sets, or `404 billing_details_not_found`. What a
 * checkout resolves the member's chosen set through.
 */
export async function ownBillingDetails(tenantId: string, clientId: string, id: string): Promise<BillingDetails> {
  const [row] = await db
    .select()
    .from(clientBillingDetails)
    .where(
      and(
        eq(clientBillingDetails.tenantId, tenantId),
        eq(clientBillingDetails.clientId, clientId),
        eq(clientBillingDetails.id, id),
      ),
    )
    .limit(1)
  if (!row) throw notFound()
  return row
}

/** The address a Purchase copies from a set: never its id, so nothing later can reach back. */
export const billingAddressOf = (row: BillingDetails): BillingAddress => ({
  name: row.name,
  line1: row.line1,
  line2: row.line2,
  city: row.city,
  state: row.state,
  postcode: row.postcode,
  country: row.country,
})

/**
 * What a checkout bills (#401): the address of the member's chosen set, ready
 * to copy onto the Purchase. Every member purchase names one, free ones
 * included (#402), so a checkout that names none is
 * `400 billing_details_required`, and a set that is not the member's own is
 * `404 billing_details_not_found`: both before anything is opened or claimed.
 */
export async function billToFor(
  tenantId: string,
  clientId: string,
  billingDetailsId: string | undefined,
): Promise<BillingAddress> {
  if (!billingDetailsId) {
    throw new BadRequestError('billing_details_required', {
      message: 'Choose the billing details this purchase is billed to.',
    })
  }
  return billingAddressOf(await ownBillingDetails(tenantId, clientId, billingDetailsId))
}

/** Hold the member's row until the transaction ends, so their sets change one request at a time. */
async function lockMember(tenantId: string, clientId: string): Promise<void> {
  const [member] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .for('update')
  if (!member) throw new NotFoundError('client_not_found')
}

/** Add a set. The member's first becomes their default; a fourth is refused. */
export async function addBillingDetails(
  tenantId: string,
  clientId: string,
  input: BillingDetailsInput,
): Promise<BillingDetails> {
  const fields = cleaned(input, true) as BillingAddress
  return db.transaction(async () => {
    await lockMember(tenantId, clientId)
    const [{ count }] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clientBillingDetails)
      .where(and(eq(clientBillingDetails.tenantId, tenantId), eq(clientBillingDetails.clientId, clientId)))) as [
      { count: number },
    ]
    if (count >= BILLING_DETAILS_LIMIT) {
      throw new ConflictError('billing_details_limit', {
        message: 'You can keep up to three sets of billing details. Edit or delete one to add another.',
      })
    }
    const [row] = await db
      .insert(clientBillingDetails)
      .values({ tenantId, clientId, ...fields, isDefault: count === 0 })
      .returning()
    return row!
  })
}

/** Change a set's fields. Fields left out keep their values. */
export async function editBillingDetails(
  tenantId: string,
  clientId: string,
  id: string,
  input: BillingDetailsInput,
): Promise<BillingDetails> {
  const fields = cleaned(input, false)
  const current = await ownBillingDetails(tenantId, clientId, id)
  if (Object.keys(fields).length === 0) return current
  const [row] = await db
    .update(clientBillingDetails)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(clientBillingDetails.tenantId, tenantId), eq(clientBillingDetails.id, current.id)))
    .returning()
  return row!
}

/**
 * Delete a set. When it was the default, the most recently added set left
 * becomes the default, so a member with any set always has one.
 */
export async function deleteBillingDetails(tenantId: string, clientId: string, id: string): Promise<void> {
  await db.transaction(async () => {
    await lockMember(tenantId, clientId)
    const current = await ownBillingDetails(tenantId, clientId, id)
    await db
      .delete(clientBillingDetails)
      .where(and(eq(clientBillingDetails.tenantId, tenantId), eq(clientBillingDetails.id, current.id)))
    if (!current.isDefault) return
    const [next] = await db
      .select({ id: clientBillingDetails.id })
      .from(clientBillingDetails)
      .where(and(eq(clientBillingDetails.tenantId, tenantId), eq(clientBillingDetails.clientId, clientId)))
      .orderBy(desc(clientBillingDetails.createdAt), desc(clientBillingDetails.id))
      .limit(1)
    if (!next) return
    await db
      .update(clientBillingDetails)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(clientBillingDetails.tenantId, tenantId), eq(clientBillingDetails.id, next.id)))
  })
}

/** Make a set the default, unsetting the one that was. */
export async function makeDefaultBillingDetails(
  tenantId: string,
  clientId: string,
  id: string,
): Promise<BillingDetails> {
  return db.transaction(async () => {
    await lockMember(tenantId, clientId)
    const current = await ownBillingDetails(tenantId, clientId, id)
    if (current.isDefault) return current
    // The old default first: the partial unique index allows only one at any moment.
    await db
      .update(clientBillingDetails)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(clientBillingDetails.tenantId, tenantId),
          eq(clientBillingDetails.clientId, clientId),
          eq(clientBillingDetails.isDefault, true),
        ),
      )
    const [row] = await db
      .update(clientBillingDetails)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(clientBillingDetails.tenantId, tenantId), eq(clientBillingDetails.id, current.id)))
      .returning()
    return row!
  })
}
