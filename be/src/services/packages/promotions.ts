import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../../db'
import { promotions } from '../../db/schema/packages'

export type PromotionRow = typeof promotions.$inferSelect
export type PromotionParent = 'class_package' | 'pt_package' | 'workshop'
export type PromotionKind = 'percent' | 'special_price'

/**
 * Fetch all in-window active promotions for a set of parent package ids.
 * Used by catalog read paths to surface "from" pricing on each package.
 */
export async function listActivePromotionsFor(
  parentType: PromotionParent,
  parentIds: string[],
  now: Date = new Date(),
): Promise<Record<string, PromotionRow[]>> {
  if (parentIds.length === 0) return {}
  const rows = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.parentType, parentType),
        eq(promotions.status, 'active'),
        lte(promotions.startsAt, now),
        gte(promotions.endsAt, now),
      ),
    )

  const byParent: Record<string, PromotionRow[]> = {}
  for (const r of rows) {
    if (!parentIds.includes(r.parentId)) continue
    const list = byParent[r.parentId] ?? []
    list.push(r)
    byParent[r.parentId] = list
  }
  return byParent
}

/**
 * Compute the effective (post-promo) price in SGD for a base price and a set of
 * in-window promotions. Returns the winning promotion id (frozen at purchase time)
 * and the effective price as a 2dp string. Best-price-wins; ties broken by lowest
 * sort_id per fe-client-features.md §6.1.
 */
export function bestPrice(
  basePriceSgd: string,
  promos: PromotionRow[],
): { effectivePriceSgd: string; appliedPromotionId: string | null } {
  const base = Number(basePriceSgd)
  let winning: { price: number; promo: PromotionRow } | null = null
  for (const p of promos) {
    let price: number
    if (p.kind === 'percent' && p.percentOff != null) {
      price = base * (1 - p.percentOff / 100)
    } else if (p.kind === 'special_price' && p.specialPriceSgd != null) {
      price = Number(p.specialPriceSgd)
    } else {
      continue
    }
    if (price >= base) continue
    if (
      !winning ||
      price < winning.price ||
      (price === winning.price && p.sortId < winning.promo.sortId)
    ) {
      winning = { price, promo: p }
    }
  }
  if (!winning) return { effectivePriceSgd: base.toFixed(2), appliedPromotionId: null }
  return {
    effectivePriceSgd: winning.price.toFixed(2),
    appliedPromotionId: winning.promo.id,
  }
}

export function serializePromotion(p: PromotionRow) {
  return {
    id: p.id,
    label: p.label,
    kind: p.kind,
    percent_off: p.percentOff,
    special_price_sgd: p.specialPriceSgd,
    starts_at: p.startsAt,
    ends_at: p.endsAt,
  }
}

/**
 * Admin read path: fetch all status='active' promos for a set of parent ids,
 * regardless of time window. Used by the admin list/detail serializers so
 * staff can see future-dated and recently expired (but still active-status)
 * promos they've configured.
 */
export async function listManagedPromotionsFor(
  parentType: PromotionParent,
  parentIds: string[],
): Promise<Record<string, PromotionRow[]>> {
  if (parentIds.length === 0) return {}
  const rows = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.parentType, parentType),
        eq(promotions.status, 'active'),
        inArray(promotions.parentId, parentIds),
      ),
    )
    .orderBy(promotions.sortId)

  const byParent: Record<string, PromotionRow[]> = {}
  for (const r of rows) {
    const list = byParent[r.parentId] ?? []
    list.push(r)
    byParent[r.parentId] = list
  }
  return byParent
}

export interface PromotionWriteInput {
  /** Server-side uuid for an existing active promo, or null/undefined for new. */
  id?: string | null
  label: string
  kind: PromotionKind
  /** For kind='percent': 1..99. Required when kind='percent', ignored otherwise. */
  percentOff?: number | null
  /** For kind='special_price': numeric string e.g. "80.00". Required for that kind. */
  specialPriceSgd?: string | null
  startsAt: Date
  endsAt: Date
}

/**
 * Replace the set of active promotions attached to a parent (class_package /
 * pt_package / workshop). Diff semantics:
 *
 *   - If an incoming item matches an existing active promo by id → UPDATE
 *   - If an existing active promo is not referenced in the payload → soft-archive
 *     (status='archived'). We never hard-delete: `client_packages.applied_promotion_id`
 *     and `class_bookings.applied_promotion_id` FK to this table and must keep
 *     resolving for the audit trail.
 *   - New items (no id, or id that doesn't match an existing active row) → INSERT
 *
 * Runs in a single transaction. Returns the resulting active set ordered by sort_id.
 */
export async function replacePromotionsForParent(
  parentType: PromotionParent,
  parentId: string,
  items: PromotionWriteInput[],
  actorStaffId: string,
): Promise<PromotionRow[]> {
  return db.transaction(async tx => {
    const existing = await tx
      .select()
      .from(promotions)
      .where(
        and(eq(promotions.parentType, parentType), eq(promotions.parentId, parentId)),
      )
    const existingActiveById = new Map(
      existing.filter(p => p.status === 'active').map(p => [p.id, p]),
    )

    const incomingActiveIds = new Set<string>()
    for (const it of items) {
      if (it.id && existingActiveById.has(it.id)) incomingActiveIds.add(it.id)
    }

    const now = new Date()

    // Soft-archive removed promos.
    for (const e of existingActiveById.values()) {
      if (!incomingActiveIds.has(e.id)) {
        await tx
          .update(promotions)
          .set({ status: 'archived', updatedAt: now })
          .where(eq(promotions.id, e.id))
      }
    }

    // Upsert each incoming item.
    for (const item of items) {
      const writeRow = {
        label: item.label,
        kind: item.kind,
        percentOff: item.kind === 'percent' ? item.percentOff ?? null : null,
        specialPriceSgd:
          item.kind === 'special_price' ? item.specialPriceSgd ?? null : null,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        status: 'active' as const,
      }
      if (item.id && existingActiveById.has(item.id)) {
        await tx
          .update(promotions)
          .set({ ...writeRow, updatedAt: now })
          .where(eq(promotions.id, item.id))
      } else {
        await tx.insert(promotions).values({
          parentType,
          parentId,
          ...writeRow,
          createdByStaffId: actorStaffId,
        })
      }
    }

    return tx
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.parentType, parentType),
          eq(promotions.parentId, parentId),
          eq(promotions.status, 'active'),
        ),
      )
      .orderBy(promotions.sortId)
  })
}
