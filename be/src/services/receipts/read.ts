/**
 * A member's own Receipts, read back exactly as they were issued (#384).
 *
 * Every figure comes off the Receipt's own snapshot. Nothing is joined from the
 * Purchase, the catalogue or the member, so what this returns is what the
 * Receipt said the day it was issued.
 */
import { and, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { receipts } from '../../db/schema/ledger'
import { sgDayWindow, type PlainDate } from '../../lib/time'
import { NotFoundError } from '../../shared/errors'
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

export const summarise = (r: ReceiptRow): ReceiptSummary => ({
  id: r.id,
  number: r.displayNumber,
  item: receiptItem(r.lines),
  issuedAt: r.issuedAt,
  totalSgd: r.totalSgd,
  status: receiptStatus(r),
})

export interface MemberReceiptQuery {
  /** The first studio day to include, `YYYY-MM-DD`. */
  from?: PlainDate
  /** The last studio day to include, `YYYY-MM-DD`. */
  to?: PlainDate
  page: number
  pageSize: number
}

/** The member's Receipts at this studio, newest first, one page of them. */
export async function listMemberReceipts(
  tenantId: string,
  clientId: string,
  query: MemberReceiptQuery,
): Promise<{ rows: ReceiptSummary[]; total: number }> {
  const where: SQL[] = [eq(receipts.tenantId, tenantId), eq(receipts.clientId, clientId)]
  if (query.from) where.push(gte(receipts.issuedAt, sgDayWindow(query.from).startsAt))
  if (query.to) where.push(lt(receipts.issuedAt, sgDayWindow(query.to).endsAt))

  const rows = await db
    .select()
    .from(receipts)
    .where(and(...where))
    .orderBy(desc(receipts.issuedAt), desc(receipts.number))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const [totals] = await db.select({ total: count() }).from(receipts).where(and(...where))
  return { rows: rows.map(summarise), total: totals?.total ?? 0 }
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
