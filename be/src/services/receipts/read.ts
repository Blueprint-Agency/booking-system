/**
 * Receipts read back exactly as they were issued: a member's own, and
 * every one at the studio for its admins.
 *
 * Every figure comes off the Receipt's own snapshot. Nothing is joined from the
 * Purchase, the catalogue or the member, so what this returns is what the
 * Receipt said the day it was issued.
 */
import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { receipts } from '../../db/schema/ledger'
import { dayWindow, type PlainDate } from '../../lib/studio-time'
import { NotFoundError } from '../../shared/errors'
import { tenantTimezone } from '../tenants/tenants'
import type { ReceiptRow } from './issue'
import { receiptItem } from './snapshot'

/** `issued`, or `refunded` once a Refund has landed on its Purchase. */
export type ReceiptStatus = 'issued' | 'refunded'

export const receiptStatus = (r: Pick<ReceiptRow, 'refundedAt'>): ReceiptStatus => (r.refundedAt ? 'refunded' : 'issued')

export interface ReceiptSummary {
  id: string
  number: string
  /** What it was for, in one phrase. */
  item: string
  issuedAt: Date
  totalSgd: string
  status: ReceiptStatus
}

const summarise = (r: ReceiptRow): ReceiptSummary => ({
  id: r.id,
  number: r.displayNumber,
  item: receiptItem(r.lines),
  issuedAt: r.issuedAt,
  totalSgd: r.totalSgd,
  status: receiptStatus(r),
})

interface MemberReceiptQuery {
  /** The first studio day to include, `YYYY-MM-DD`. */
  from?: PlainDate
  /** The last studio day to include, `YYYY-MM-DD`. */
  to?: PlainDate
  page: number
  pageSize: number
}

/**
 * The member's Receipts at this studio, newest first, one page of them: the
 * studio's list (`receiptsPage`), kept to the one member's.
 */
export async function listMemberReceipts(
  tenantId: string,
  clientId: string,
  query: MemberReceiptQuery,
): Promise<{ rows: ReceiptSummary[]; total: number }> {
  const where = await receiptsWhere(tenantId, { clientId, from: query.from, to: query.to })
  const { rows, total } = await receiptsPage(where, query)
  return { rows: rows.map(summarise), total }
}

/**
 * One of the member's Receipts, whole. Anyone else's — another member's, or a
 * Receipt at another studio — is the same 404 as one that does not exist.
 */
export async function memberReceipt(tenantId: string, clientId: string, receiptId: string): Promise<ReceiptRow> {
  const [row] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.clientId, clientId), eq(receipts.id, receiptId)))
    .limit(1)
  if (!row) throw new NotFoundError('receipt_not_found')
  return row
}

/** A row of the studio's Receipts list: the member's row, and who it was for. */
export interface StudioReceiptSummary extends ReceiptSummary {
  kind: ReceiptRow['kind']
  /** Null once the member has been permanently deleted. */
  clientId: string | null
  /** The buyer as the Receipt names them; emptied by a permanent deletion. */
  buyerName: string | null
  buyerEmail: string | null
  /** Who the sale is billed to, or null where no Billing details were chosen; emptied by a permanent deletion. */
  billTo: ReceiptRow['billTo']
}

/** What narrows the studio's Receipts: the admin's search and filters. */
interface StudioReceiptFilters {
  /** Part of a receipt number, or of the buyer's name or email, as the Receipt has them. */
  q?: string
  /** The first studio day to include, `YYYY-MM-DD`. */
  from?: PlainDate
  /** The last studio day to include, `YYYY-MM-DD`. */
  to?: PlainDate
  kind?: ReceiptRow['kind']
  status?: ReceiptStatus
}

interface StudioReceiptQuery extends StudioReceiptFilters, MemberReceiptQuery {}

/**
 * The studio's Receipts the filters keep, or one member's of them. The search
 * reads the Receipt's own snapshot.
 */
async function receiptsWhere(
  tenantId: string,
  query: StudioReceiptFilters & { clientId?: string },
): Promise<SQL | undefined> {
  const where: SQL[] = [eq(receipts.tenantId, tenantId)]
  if (query.clientId) where.push(eq(receipts.clientId, query.clientId))
  // `from` and `to` are the studio's calendar days, on its own clock.
  if (query.from || query.to) {
    const timezone = await tenantTimezone(tenantId)
    if (query.from) where.push(gte(receipts.issuedAt, dayWindow(timezone, query.from).startsAt))
    if (query.to) where.push(lt(receipts.issuedAt, dayWindow(timezone, query.to).endsAt))
  }
  if (query.kind) where.push(eq(receipts.kind, query.kind))
  if (query.status === 'refunded') where.push(isNotNull(receipts.refundedAt))
  if (query.status === 'issued') where.push(isNull(receipts.refundedAt))
  const term = query.q?.trim()
  if (term) {
    const like = `%${term}%`
    where.push(or(ilike(receipts.displayNumber, like), ilike(receipts.buyerName, like), ilike(receipts.buyerEmail, like))!)
  }
  return and(...where)
}

/** The Receipts `where` keeps, newest first, one page of them, and how many it keeps in all. */
async function receiptsPage(
  where: SQL | undefined,
  page: Pick<MemberReceiptQuery, 'page' | 'pageSize'>,
): Promise<{ rows: ReceiptRow[]; total: number }> {
  const rows = await db
    .select()
    .from(receipts)
    .where(where)
    .orderBy(desc(receipts.issuedAt), desc(receipts.number))
    .limit(page.pageSize)
    .offset((page.page - 1) * page.pageSize)
  const [totals] = await db.select({ total: count() }).from(receipts).where(where)
  return { rows, total: totals?.total ?? 0 }
}

const studioSummary = (r: ReceiptRow): StudioReceiptSummary => ({
  ...summarise(r),
  kind: r.kind,
  clientId: r.clientId,
  buyerName: r.buyerName,
  buyerEmail: r.buyerEmail,
  billTo: r.billTo,
})

/**
 * Every Receipt at this studio, newest first, one page of them: the admin's
 * Receipts page. The search reads the Receipt's own snapshot, the
 * number and the buyer it names, as everything else on a Receipt does.
 */
export async function listStudioReceipts(
  tenantId: string,
  query: StudioReceiptQuery,
): Promise<{ rows: StudioReceiptSummary[]; total: number }> {
  const { rows, total } = await receiptsPage(await receiptsWhere(tenantId, query), query)
  return { rows: rows.map(studioSummary), total }
}

/**
 * Every Receipt the admin's filters keep, newest first, unpaged: the list as a
 * file for the bookkeeper. The same filters and order as the list, so
 * the export is the list the admin was looking at, every page of it.
 */
export async function exportStudioReceipts(
  tenantId: string,
  filters: StudioReceiptFilters,
): Promise<{ rows: StudioReceiptSummary[]; timezone: string }> {
  const rows = await db
    .select()
    .from(receipts)
    .where(await receiptsWhere(tenantId, filters))
    .orderBy(desc(receipts.issuedAt), desc(receipts.number))
  // The zone the file's dates are written on: the studio's own.
  return { rows: rows.map(studioSummary), timezone: await tenantTimezone(tenantId) }
}

/**
 * One Receipt at this studio, whole, for its admins. Another studio's is the
 * same 404 as one that does not exist.
 */
export async function studioReceipt(tenantId: string, receiptId: string): Promise<ReceiptRow> {
  const [row] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, receiptId)))
    .limit(1)
  if (!row) throw new NotFoundError('receipt_not_found')
  return row
}

/**
 * The Receipt a Purchase was issued, whoever's it is, or null: for the
 * backend's own sends (the confirmation email), never for a member's
 * request, which goes through the member-scoped reads above.
 */
export async function purchaseReceipt(tenantId: string, purchaseId: string | null): Promise<ReceiptRow | null> {
  if (!purchaseId) return null
  const [row] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.purchaseId, purchaseId)))
    .limit(1)
  return row ?? null
}

/** The Receipt a Purchase has, if any: what the confirmation page links to. */
export async function receiptForPurchase(
  tenantId: string,
  clientId: string,
  purchaseId: string,
): Promise<ReceiptSummary | null> {
  const [row] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.clientId, clientId), eq(receipts.purchaseId, purchaseId)))
    .limit(1)
  return row ? summarise(row) : null
}
