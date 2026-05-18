import { and, eq, gte, lte } from 'drizzle-orm'
import { db } from '../../db'
import { promotions } from '../../db/schema/packages'

export type PromotionRow = typeof promotions.$inferSelect
export type PromotionParent = 'class_package' | 'pt_package' | 'workshop'

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
    if (!byParent[r.parentId]) byParent[r.parentId] = []
    byParent[r.parentId].push(r)
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
