/**
 * Redeeming a Promo Code at checkout (spec-pre-launch-batch.md §10–§11).
 *
 * The rules are pure and live in `promo-codes.ts`; this is the database half —
 * the row lock, the Hold, and the flip to Consumed. Nothing here decides
 * anything the pure module could decide.
 *
 * The cap is hard because the *place* is claimed when checkout starts, not when
 * payment succeeds: the code's row is locked, the places are counted under that
 * lock, and a `held` row is upserted with the payment session's own expiry. Two
 * members racing for the last place are serialised by the lock, so one is told
 * "fully claimed" BEFORE paying rather than after.
 *
 * Nothing sweeps a lapsed Hold. A used place is `consumed OR held_until > now()`
 * and `occupiesPlace` is the whole of that mechanism.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import {
  classPackages,
  promoCodeProducts,
  promoCodeRedemptions,
  promoCodes,
  ptPackages,
} from '../../db/schema/packages'
import { workshopTiers, workshops } from '../../db/schema/schedule'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { bestPrice, listActivePromotionsFor } from './promotions'
import { tierEffectivePrice } from '../workshops/book'
import {
  evaluatePromoCode,
  holdExpiryFrom,
  normaliseCode,
  refusalMessage,
  type ProductRef,
} from './promo-codes'

export interface RedemptionInput {
  /** What the member typed. Normalised here — entry is case- and space-insensitive. */
  codeText: string
  clientId: string
  product: ProductRef
  /** Named in the out-of-scope sentence. */
  productName: string
  /** Price after any automatic Promotion — a code takes its cut of that figure. */
  basePriceSgd: string
}

export interface AppliedPromoCode {
  promoCodeId: string
  /** The normalised, stored form. */
  code: string
  label: string
  discountSgd: string
  effectivePriceSgd: string
  /**
   * When the Hold lapses — the moment the payment session must expire at too.
   * Null for an uncapped code, whose checkout keeps the standard 24 hours.
   */
  holdExpiresAt: Date | null
}

/** A bad code is refused, never silently ignored and charged at full price. */
function refuse(refusal: Parameters<typeof refusalMessage>[0], productName: string): never {
  throw new BadRequestError('promo_code_invalid', {
    reason: refusal,
    message: refusalMessage(refusal, productName),
  })
}

async function readCode(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  codeText: string,
  lock: boolean,
) {
  const q = tx.select().from(promoCodes).where(eq(promoCodes.code, normaliseCode(codeText)))
  const [code] = lock ? await q.for('update').limit(1) : await q.limit(1)
  if (!code) return null
  const [scope, redemptions] = await Promise.all([
    tx.select().from(promoCodeProducts).where(eq(promoCodeProducts.promoCodeId, code.id)),
    tx.select().from(promoCodeRedemptions).where(eq(promoCodeRedemptions.promoCodeId, code.id)),
  ])
  return { code, scope, redemptions }
}

/**
 * What is being bought, named and priced. The validation endpoint takes the
 * product alongside the code so it can answer the scope case — a green tick
 * contradicted by a refusal seconds later is worse than no tick at all.
 *
 * A workshop is identified by its workshop id, never its tier: scoping is at
 * workshop level. The tier only sets the price.
 */
export async function describeProduct(
  input:
    | { packageKind: 'class' | 'pt'; packageId: string }
    | { workshopId: string; workshopTierId: string },
): Promise<{ product: ProductRef; name: string; basePriceSgd: string }> {
  if ('workshopId' in input) {
    const [tier] = await db
      .select()
      .from(workshopTiers)
      .where(
        and(
          eq(workshopTiers.id, input.workshopTierId),
          eq(workshopTiers.workshopId, input.workshopId),
        ),
      )
      .limit(1)
    if (!tier) throw new NotFoundError('workshop_tier_not_found')
    const [ws] = await db
      .select({ name: workshops.name })
      .from(workshops)
      .where(eq(workshops.id, input.workshopId))
      .limit(1)
    if (!ws) throw new NotFoundError('workshop_not_found')
    const promos = await listActivePromotionsFor('workshop', [input.workshopId])
    const eff = tierEffectivePrice(tier, promos[input.workshopId] ?? [])
    return {
      product: { productType: 'workshop', productId: input.workshopId },
      name: `${ws.name} — ${tier.name}`,
      basePriceSgd: eff.baseSgd,
    }
  }

  const table = input.packageKind === 'class' ? classPackages : ptPackages
  const productType = input.packageKind === 'class' ? 'class_package' : 'pt_package'
  const [pkg] = await db
    .select({ id: table.id, name: table.name, priceSgd: table.priceSgd })
    .from(table)
    .where(and(eq(table.id, input.packageId), isNull(table.deletedAt)))
    .limit(1)
  if (!pkg) {
    throw new NotFoundError(
      input.packageKind === 'class' ? 'class_package_not_found' : 'pt_package_not_found',
    )
  }
  const promos = await listActivePromotionsFor(productType, [pkg.id])
  const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
  return {
    product: { productType, productId: pkg.id },
    name: pkg.name,
    basePriceSgd: eff.effectivePriceSgd,
  }
}

/**
 * Read-only preview for the validation endpoint. It takes the product as well
 * as the code so it can answer the scope case — otherwise a green tick would be
 * contradicted by a refusal seconds later. It takes no Hold: a place is claimed
 * when checkout starts, not when a member types.
 */
export async function previewPromoCode(input: RedemptionInput): Promise<AppliedPromoCode> {
  const found = await readCode(db, input.codeText, false)
  const evaluated = evaluatePromoCode({
    code: found?.code ?? null,
    scope: found?.scope ?? [],
    redemptions: found?.redemptions ?? [],
    clientId: input.clientId,
    product: input.product,
    basePriceSgd: input.basePriceSgd,
  })
  if (!evaluated.ok) refuse(evaluated.refusal, input.productName)
  return {
    promoCodeId: found!.code.id,
    code: found!.code.code,
    label: found!.code.label,
    discountSgd: evaluated.discountSgd,
    effectivePriceSgd: evaluated.effectivePriceSgd,
    holdExpiresAt: null,
  }
}

/**
 * Claim a place. Run at the start of checkout, before the payment session
 * exists, so the session can be given the Hold's own expiry.
 *
 * A discount that takes the total to zero skips the payment provider entirely,
 * so its Redemption is written straight to `consumed` — there is no later
 * webhook to flip it.
 */
export async function holdPromoCode(input: RedemptionInput): Promise<AppliedPromoCode> {
  return db.transaction(async tx => {
    const now = new Date()
    const found = await readCode(tx, input.codeText, true)
    const evaluated = evaluatePromoCode({
      code: found?.code ?? null,
      scope: found?.scope ?? [],
      redemptions: found?.redemptions ?? [],
      clientId: input.clientId,
      product: input.product,
      basePriceSgd: input.basePriceSgd,
      now,
    })
    if (!evaluated.ok) refuse(evaluated.refusal, input.productName)

    const code = found!.code
    const free = Number(evaluated.effectivePriceSgd) <= 0
    const heldUntil = holdExpiryFrom(now)
    const row = {
      status: free ? ('consumed' as const) : ('held' as const),
      heldUntil,
      consumedAt: free ? now : null,
      discountSgd: evaluated.discountSgd,
    }
    // Upsert, not insert: a member who abandoned a checkout and came back owns
    // this row already, and the one-use-per-member index is what makes the
    // retry update it rather than collide.
    // ponytail: while that index is total rather than partial, this also
    // overwrites a `refunded` row instead of writing a second one. The refunds
    // ticket makes the index partial, at which point the evidence survives.
    await tx
      .insert(promoCodeRedemptions)
      .values({ promoCodeId: code.id, clientId: input.clientId, ...row })
      .onConflictDoUpdate({
        target: [promoCodeRedemptions.promoCodeId, promoCodeRedemptions.clientId],
        set: { ...row, stripePaymentIntentId: null, updatedAt: now },
      })

    return {
      promoCodeId: code.id,
      code: code.code,
      label: code.label,
      discountSgd: evaluated.discountSgd,
      effectivePriceSgd: evaluated.effectivePriceSgd,
      // Only a capped code shortens the session. Uncapped and code-free
      // checkouts keep the standard 24 hours.
      holdExpiresAt: code.maxRedemptions != null ? heldUntil : null,
    }
  })
}

/**
 * Payment succeeded — flip the Hold to Consumed and stamp the moment and the
 * payment intent. Only a `held` row moves, so a redelivered webhook cannot
 * rewrite a Redemption that is already Consumed.
 */
export async function consumePromoCodeHold(args: {
  promoCodeId: string
  clientId: string
  paymentIntentId: string
}): Promise<void> {
  const now = new Date()
  await db
    .update(promoCodeRedemptions)
    .set({
      status: 'consumed',
      consumedAt: now,
      stripePaymentIntentId: args.paymentIntentId,
      updatedAt: now,
    })
    .where(
      and(
        eq(promoCodeRedemptions.promoCodeId, args.promoCodeId),
        eq(promoCodeRedemptions.clientId, args.clientId),
        eq(promoCodeRedemptions.status, 'held'),
      ),
    )
}
