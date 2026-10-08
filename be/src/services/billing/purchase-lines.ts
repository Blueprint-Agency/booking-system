/**
 * What was in a Purchase, line by line, frozen the moment it opens (#382).
 *
 * `item_name` names a sale in one phrase; these say what made up its total — a
 * plan and the Cross-Location Add-On beside it, the List Price of each, and the
 * Promotion or Promo Code that took something off. They are what a Receipt is
 * built from, so they are written once, at checkout, from the same prices the
 * payment provider is asked to charge, and never recomputed from a catalogue
 * that may have moved since.
 *
 * Pure: no database, so the arithmetic a Receipt will print can be checked
 * without one.
 */
import { toCents, toSgd } from '../../shared/money'

/** Where a discount came from. An early-bird price is a workshop tier's own, and has no id of its own. */
export type DiscountSource = 'promotion' | 'promo_code' | 'early_bird'

export interface LineDiscount {
  source: DiscountSource
  /** The Promotion's or Promo Code's id; null for an early-bird price. */
  id: string | null
  /** What the member was shown: the Promotion's label, the code they typed. */
  label: string
  amountSgd: string
}

/**
 * One line of a sale. `amountSgd` is what the member pays for it:
 * `quantity × listPriceSgd − discountSgd`, and a Purchase's lines add up to
 * its frozen total.
 */
export interface PurchaseLine {
  description: string
  quantity: number
  /** The price of one, before anything was taken off. */
  listPriceSgd: string
  /** Everything taken off the line, the sum of `discounts`. */
  discountSgd: string
  /** Each discount in the order it was applied: a Promotion first, then a Promo Code on what it left. */
  discounts: LineDiscount[]
  amountSgd: string
}

/**
 * One thing that lowered the price, and the price of one it left. Given as the
 * price after it, not as money off, because that is what the pricing rules
 * answer (`bestPrice`, a Promo Code's effective price): the line then ends at
 * exactly the price the checkout charges, never at a second sum of its own.
 */
export interface LineReduction {
  source: DiscountSource
  id: string | null
  label: string
  priceSgd: string
}

export interface SaleLineInput {
  description: string
  listPriceSgd: string
  quantity?: number
  /**
   * In the order they were applied: a Promotion or an early-bird price, then a
   * Promo Code on what that left. Null entries, and one that lowers nothing,
   * are skipped.
   */
  reductions?: Array<LineReduction | null>
}

/**
 * Build one line from its List Price and the prices each reduction left.
 *
 * Each discount is the drop from the price before it, so the discounts and the
 * amount always add back up to the List Price. Nothing takes a line below zero.
 */
export function saleLine(input: SaleLineInput): PurchaseLine {
  const quantity = input.quantity ?? 1
  const listCents = toCents(input.listPriceSgd)
  let unitCents = listCents
  const discounts: LineDiscount[] = []
  for (const step of input.reductions ?? []) {
    if (!step) continue
    const nextCents = Math.max(Math.min(toCents(step.priceSgd), unitCents), 0)
    if (nextCents === unitCents) continue
    discounts.push({ source: step.source, id: step.id, label: step.label, amountSgd: toSgd((unitCents - nextCents) * quantity) })
    unitCents = nextCents
  }
  return {
    description: input.description,
    quantity,
    listPriceSgd: toSgd(listCents),
    discountSgd: toSgd((listCents - unitCents) * quantity),
    discounts,
    amountSgd: toSgd(unitCents * quantity),
  }
}

/**
 * The Promotion `bestPrice` chose, as a reduction: null when it chose none.
 * Its label is read off the same live Promotions the price was chosen from.
 */
export function promotionReduction(
  promotions: Array<{ id: string; label: string }>,
  appliedPromotionId: string | null,
  priceSgd: string,
): LineReduction | null {
  if (!appliedPromotionId) return null
  const promotion = promotions.find(p => p.id === appliedPromotionId)
  return { source: 'promotion', id: appliedPromotionId, label: promotion?.label ?? 'Promotion', priceSgd }
}

/** The Promo Code the member typed, as a reduction: the code itself, and the price it left. */
export function promoCodeReduction(
  applied: { promoCodeId: string; code: string; effectivePriceSgd: string } | null,
): LineReduction | null {
  if (!applied) return null
  return { source: 'promo_code', id: applied.promoCodeId, label: applied.code, priceSgd: applied.effectivePriceSgd }
}

/** What a sale's lines add up to, in cents. */
export const linesTotalCents = (lines: PurchaseLine[]): number =>
  lines.reduce((sum, line) => sum + toCents(line.amountSgd), 0)
