/**
 * The Finance overview — the block of figures an owner reads before they read
 * any individual row.
 *
 * The money half is NOT re-queried. It is `getFinance` over the same period,
 * regrouped: a category breakdown that came from its own SUM would eventually
 * disagree with the Gross tile sitting inches above it, and the disagreement
 * would be discovered by an owner, not by a test.
 *
 * The rest — members, class popularity — is about people and attendance
 * rather than money, has no home in the Money Event model, and is queried here.
 * One of them, Active Members, is not period-scoped at all; `memberCounts` says
 * why, and the tile says so to the reader.
 */
import { and, count, countDistinct, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'
import { clients } from '../../db/schema/identity'
import { bookings } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { isMoneyIn } from './events'
import { getFinance, type FinanceFilter } from './list'
import { toCents } from './totals'
import type { FinanceInstructorTotal, FinanceLine, FinanceTotals } from './totals'

/**
 * What the studio sells, as an owner groups it — coarser than `MoneyEventType`
 * on purpose. An owner asks "how did classes do", not "how did Credit bundles
 * do versus Unlimited versus Trial"; those three plus the Cross-Location Add-On
 * are all someone paying to come to class.
 */
export type SaleCategory = 'classes' | 'pt' | 'workshops' | 'corporate' | 'merch'

const SALE_CATEGORY: Partial<Record<FinanceLine['type'], SaleCategory>> = {
  credit: 'classes',
  unlimited: 'classes',
  trial: 'classes',
  addon: 'classes',
  pt_package: 'pt',
  workshop: 'workshops',
  corporate: 'corporate',
  merch: 'merch',
}

/** Fixed order, so the breakdown doesn't reshuffle itself between periods. */
const CATEGORY_ORDER: readonly SaleCategory[] = ['classes', 'pt', 'workshops', 'corporate', 'merch']

export interface CategorySales {
  category: SaleCategory
  /** Sum of List Price — sums to the Gross tile across all categories. */
  gross_sgd: number
  /** What was actually taken. Gross minus this is what the category discounted. */
  collected_sgd: number
  /** How many transactions, not how many items. */
  count: number
}

export interface MemberCounts {
  /**
   * Members holding a live entitlement RIGHT NOW — an active, unexpired
   * package. The stock, not the flow: it does not change with a longer period
   * the way a count of purchases would, and it does not move with the period at
   * all. See `memberCounts` for why it cannot be dated to the period's end.
   */
  active: number
  /** Members who joined during the period. The flow. */
  joined: number
}

export interface ClassPopularity {
  class_type_id: string
  name: string
  /** Attendances — check-ins, not bookings. A booked no-show is not popularity. */
  attended: number
  /**
   * The same count over the equally-long window immediately before this one.
   * Null when the period has no start (All time), where "before" means nothing.
   */
  previous: number | null
}

export interface FinanceOverview {
  totals: FinanceTotals
  /** Sessions with no pay set. Excluded from Net, so Net has to say so. */
  unpriced_count: number
  sales_by_category: CategorySales[]
  by_instructor: FinanceInstructorTotal[]
  members: MemberCounts
  classes: ClassPopularity[]
}

export function salesByCategory(rows: readonly FinanceLine[]): CategorySales[] {
  const acc = new Map<SaleCategory, { gross: number; collected: number; count: number }>()
  for (const r of rows) {
    // Money-out rows share types with money-in ones — a Workshop is both a
    // ticket sold and an instructor paid. Only the sale side is a sale.
    if (!isMoneyIn(r.kind)) continue
    const category = SALE_CATEGORY[r.type]
    if (!category) continue
    if (r.list_price_sgd == null || r.paid_sgd == null) continue
    const t = acc.get(category) ?? { gross: 0, collected: 0, count: 0 }
    t.gross += toCents(r.list_price_sgd)
    t.collected += toCents(r.paid_sgd)
    t.count += 1
    acc.set(category, t)
  }
  return CATEGORY_ORDER.map(category => {
    const t = acc.get(category)
    return {
      category,
      gross_sgd: (t?.gross ?? 0) / 100,
      collected_sgd: (t?.collected ?? 0) / 100,
      count: t?.count ?? 0,
    }
  })
}

/**
 * Attendances per class type over one window. Check-ins, not bookings.
 *
 * Half-open — `[from, to)`. The previous window ends exactly where this one
 * starts, so a closed upper bound would count a class starting on the boundary
 * in BOTH windows, inflating `previous` and flattening the trend it feeds.
 */
async function attendanceByClassType(
  tenantId: string,
  from: Date | undefined,
  to: Date | undefined,
) {
  const conds = [eq(bookings.tenantId, tenantId), eq(bookings.checkInState, 'attended')]
  if (from) conds.push(gte(classes.startsAt, from))
  if (to) conds.push(lt(classes.startsAt, to))
  return db
    .select({ id: classTypes.id, name: classTypes.name, attended: count() })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .where(and(...conds))
    .groupBy(classTypes.id, classTypes.name)
}

/**
 * The window of the same length immediately before this one — the comparison
 * "trend" means. Null unless the period is bounded at both ends: with no start
 * there is no length to step back by, and a trend against an unbounded window
 * would compare a month to the studio's entire history.
 */
export function previousWindow(from: Date | undefined, to: Date | undefined) {
  if (!from || !to) return null
  const span = to.getTime() - from.getTime()
  return { from: new Date(from.getTime() - span), to: new Date(from.getTime()) }
}

async function classPopularity(
  tenantId: string,
  filter: FinanceFilter,
): Promise<ClassPopularity[]> {
  const prevWindow = previousWindow(filter.from, filter.to)
  const [current, previous] = await Promise.all([
    attendanceByClassType(tenantId, filter.from, filter.to),
    prevWindow
      ? attendanceByClassType(tenantId, prevWindow.from, prevWindow.to)
      : Promise.resolve([]),
  ])
  const before = new Map(previous.map(r => [r.id, r.attended]))
  return current
    .map(r => ({
      class_type_id: r.id,
      name: r.name,
      attended: r.attended,
      // A class type absent from the previous window ran to nobody, which is
      // zero — not "unknown". Unknown is the whole window being absent.
      previous: prevWindow ? (before.get(r.id) ?? 0) : null,
    }))
    .sort((a, b) => b.attended - a.attended || a.name.localeCompare(b.name))
}

/**
 * Active Members is measured NOW, not at the period's end, and the tile says so.
 *
 * Dating it backwards is not something this schema can do. `client_packages.active`
 * is a live boolean with no history: it is flipped down by expiry, by a refund,
 * and by the balance reaching zero, and only the first two leave a date behind
 * (`expires_at`, `stripe_payments.refunded_at`). Exhaustion leaves none, because
 * `credits_or_sessions_remaining` is a mutable counter rather than a ledger.
 *
 * So an `as of <past date>` query built on this column reads today's flag against
 * a historical expiry bound, and silently UNDERCOUNTS every closed period: a
 * bundle that was live through June but was used up in July is `active = false`
 * now, and drops out of June's figure. The undercount deepens the further back
 * you look, which is the worst possible shape for a figure an owner compares
 * month to month.
 *
 * A figure that is true and doesn't move is better than one that moves for a
 * reason nobody can see. `joined` below is genuinely period-scoped and stays so.
 *
 * ponytail: no history for `active`. A real stock-at-a-date needs either a
 * `deactivated_at` column on `client_packages` (set at all three flip sites) or
 * a credit ledger to replay the balance from. Both are schema changes — see
 * be/docs/adr/0003.
 */
async function memberCounts(tenantId: string, filter: FinanceFilter): Promise<MemberCounts> {
  const [active] = await db
    .select({ n: countDistinct(clientPackages.clientId) })
    .from(clientPackages)
    .innerJoin(clients, eq(clients.id, clientPackages.clientId))
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.active, true),
        isNull(clients.deletedAt),
        // Expiry flips `active` on a nightly sweep, so between the expiry and
        // 01:00 SGT the flag is stale. The bound closes that window.
        // A Dormant Unlimited Plan has no expiry yet (its clock starts at
        // Activation). It is an entitlement the member holds, so it counts.
        or(isNull(clientPackages.expiresAt), gte(clientPackages.expiresAt, sql`now()`)),
      ),
    )

  const joinedConds = [eq(clients.tenantId, tenantId), isNull(clients.deletedAt)]
  if (filter.from) joinedConds.push(gte(clients.joinedAt, filter.from))
  if (filter.to) joinedConds.push(lte(clients.joinedAt, filter.to))
  const [joined] = await db.select({ n: count() }).from(clients).where(and(...joinedConds))

  return { active: active?.n ?? 0, joined: joined?.n ?? 0 }
}

/**
 * The overview for a period. Takes the same filter the ledger does so the two
 * can be driven by one set of controls, but reads only its date bounds — a
 * breakdown narrowed to one instructor is not an overview of anything.
 */
export async function getFinanceOverview(
  tenantId: string,
  filter: FinanceFilter,
): Promise<FinanceOverview> {
  const period: FinanceFilter = { from: filter.from, to: filter.to }
  const [finance, members, classPopularityRows] = await Promise.all([
    getFinance(tenantId, period),
    memberCounts(tenantId, period),
    classPopularity(tenantId, period),
  ])

  return {
    totals: finance.totals,
    unpriced_count: finance.unpriced_count,
    sales_by_category: salesByCategory(finance.rows),
    by_instructor: finance.instructor_totals,
    members,
    classes: classPopularityRows,
  }
}
