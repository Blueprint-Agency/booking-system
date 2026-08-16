/**
 * Admin CRUD for Promo Codes (spec-pre-launch-batch.md §9–§11).
 *
 * The rules live in `promo-codes.ts` and stay pure; this module is the database
 * half — reads, writes, and the two invariants Postgres cannot hold on its own:
 *
 *   1. `applies_to_all = true` means NO scope rows. That spans rows, so it is
 *      enforced here.
 *   2. `promo_code_products.product_id` carries no foreign key (the parent
 *      table varies, exactly like `promotions.parent_id`), so existence is
 *      checked here.
 *
 * Redeeming a code at checkout is a separate surface and is not built here.
 */
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { isUniqueViolation } from '../../db/unique-violation'
import {
  classPackages,
  promoCodeProducts,
  promoCodeRedemptions,
  promoCodes,
  ptPackages,
} from '../../db/schema/packages'
import { workshops } from '../../db/schema/schedule'
import type { PromoCodeKind, PromoCodeProduct, PromoCodeStatus } from '../../db/enums'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import {
  generateCode,
  isValidCode,
  missingMoneyField,
  normaliseCode,
  type ProductRef,
  type PromoCodeProductRow,
  type PromoCodeRow,
} from './promo-codes'

export interface PromoCodeDetail {
  code: PromoCodeRow
  products: PromoCodeProductRow[]
  /** Total Redemption rows of any status. Non-zero freezes the code text and the money off. */
  redemptionCount: number
}

const PRODUCT_TABLES = {
  class_package: classPackages,
  pt_package: ptPackages,
  workshop: workshops,
} as const

/**
 * Every product id must name a live row of its declared type. Corporate
 * packages are absent from `PromoCodeProduct` entirely — corporate is
 * direct-pay and not scopable, so there is nothing to check for it.
 * Workshops are matched at workshop level; a tier is never a scope row.
 */
async function assertProductsExist(products: ProductRef[]): Promise<void> {
  const byType = new Map<PromoCodeProduct, Set<string>>()
  for (const p of products) {
    const set = byType.get(p.productType) ?? new Set<string>()
    set.add(p.productId)
    byType.set(p.productType, set)
  }
  for (const [type, ids] of byType) {
    const table = PRODUCT_TABLES[type]
    const found = await db
      .select({ id: table.id })
      .from(table)
      .where(inArray(table.id, [...ids]))
    if (found.length !== ids.size) {
      const missing = [...ids].filter(id => !found.some(f => f.id === id))
      throw new BadRequestError('promo_code_product_not_found', { productType: type, missing })
    }
  }
}

/** `applies_to_all = true` means no rows; anything else must name at least one product. */
function assertScopeShape(appliesToAll: boolean, products: ProductRef[]): void {
  if (appliesToAll && products.length > 0) {
    throw new BadRequestError('promo_code_scope_conflict')
  }
  if (!appliesToAll && products.length === 0) {
    throw new BadRequestError('promo_code_scope_empty')
  }
}

/** Did this write lose the race for the code's one unique index? */
const isCodeCollision = (err: unknown): boolean =>
  isUniqueViolation(err, 'promo_codes_code_unique')

async function redemptionCountFor(promoCodeId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(promoCodeRedemptions)
    .where(eq(promoCodeRedemptions.promoCodeId, promoCodeId))
  return Number(row?.n ?? 0)
}

export async function listPromoCodes(opts: { status?: PromoCodeStatus } = {}): Promise<
  PromoCodeDetail[]
> {
  const rows = await db
    .select()
    .from(promoCodes)
    .where(opts.status ? eq(promoCodes.status, opts.status) : undefined)
    .orderBy(promoCodes.createdAt)
  if (rows.length === 0) return []

  const ids = rows.map(r => r.id)
  const scope = await db
    .select()
    .from(promoCodeProducts)
    .where(inArray(promoCodeProducts.promoCodeId, ids))
  const counts = await db
    .select({ id: promoCodeRedemptions.promoCodeId, n: count() })
    .from(promoCodeRedemptions)
    .where(inArray(promoCodeRedemptions.promoCodeId, ids))
    .groupBy(promoCodeRedemptions.promoCodeId)

  return rows.map(code => ({
    code,
    products: scope.filter(s => s.promoCodeId === code.id),
    redemptionCount: Number(counts.find(c => c.id === code.id)?.n ?? 0),
  }))
}

export async function getPromoCode(id: string): Promise<PromoCodeDetail> {
  const [code] = await db.select().from(promoCodes).where(eq(promoCodes.id, id)).limit(1)
  if (!code) throw new NotFoundError('promo_code_not_found')
  const products = await db
    .select()
    .from(promoCodeProducts)
    .where(eq(promoCodeProducts.promoCodeId, id))
  return { code, products, redemptionCount: await redemptionCountFor(id) }
}

export interface CreatePromoCodeInput {
  /** Omit to have one generated from the unambiguous alphabet. */
  code?: string | null
  label: string
  kind: PromoCodeKind
  percentOff?: number | null
  amountOffSgd?: string | null
  maxRedemptions?: number | null
  expiresAt?: Date | null
  appliesToAll: boolean
  products: ProductRef[]
}

/**
 * The kind↔money-field pairing (§9), refused here rather than nulled away, so a
 * caller that skips the route cannot write a row the check constraint then
 * rejects with a 500.
 */
function moneyFields(input: {
  kind: PromoCodeKind
  percentOff?: number | null
  amountOffSgd?: string | null
}) {
  const missing = missingMoneyField(input)
  if (missing) throw new BadRequestError(missing)
  return {
    kind: input.kind,
    percentOff: input.kind === 'percent' ? input.percentOff ?? null : null,
    amountOffSgd: input.kind === 'amount' ? input.amountOffSgd ?? null : null,
  }
}

async function insertScope(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  promoCodeId: string,
  products: ProductRef[],
): Promise<PromoCodeProductRow[]> {
  if (products.length === 0) return []
  return tx
    .insert(promoCodeProducts)
    .values(
      products.map(p => ({ promoCodeId, productType: p.productType, productId: p.productId })),
    )
    // The same product named twice is one scope row, not an error — the composite
    // PK collapses it. Without this the duplicate raises a 23505 that reads like
    // a lost race for the code text.
    .onConflictDoNothing()
    .returning()
}

export async function createPromoCode(
  input: CreatePromoCodeInput,
  actorStaffId: string,
): Promise<PromoCodeDetail> {
  assertScopeShape(input.appliesToAll, input.products)
  await assertProductsExist(input.products)

  const custom = input.code == null ? null : normaliseCode(input.code)
  if (custom !== null && !isValidCode(custom)) {
    throw new BadRequestError('promo_code_text_invalid')
  }

  // Generated and custom text share one namespace behind one unique index, so
  // a collision cannot be checked away — it is retried away.
  const attempts = custom !== null ? 1 : 5
  for (let i = 0; i < attempts; i++) {
    const text = custom ?? generateCode()
    try {
      return await db.transaction(async tx => {
        const [row] = await tx
          .insert(promoCodes)
          .values({
            code: text,
            label: input.label,
            ...moneyFields(input),
            maxRedemptions: input.maxRedemptions ?? null,
            expiresAt: input.expiresAt ?? null,
            appliesToAll: input.appliesToAll,
            status: 'active',
            createdByStaffId: actorStaffId,
          })
          .returning()
        const products = await insertScope(tx, row!.id, input.products)
        return { code: row!, products, redemptionCount: 0 }
      })
    } catch (err: unknown) {
      if (!isCodeCollision(err)) throw err
      if (custom !== null) throw new ConflictError('promo_code_text_taken')
    }
  }
  throw new ConflictError('promo_code_generation_exhausted')
}

export interface UpdatePromoCodeInput {
  label?: string
  maxRedemptions?: number | null
  expiresAt?: Date | null
  appliesToAll?: boolean
  products?: ProductRef[]
  // The two frozen-on-first-Redemption fields. See below.
  code?: string
  kind?: PromoCodeKind
  percentOff?: number | null
  amountOffSgd?: string | null
}

/**
 * Edit a live code. Label, expiry, cap and product list stay editable for the
 * code's whole life.
 *
 * The code text and the money off are editable only until the first Redemption
 * exists — after that, changing either would rewrite terms a member has already
 * accepted, so it is refused. To stop a code, archive it.
 */
export async function updatePromoCode(
  id: string,
  patch: UpdatePromoCodeInput,
): Promise<PromoCodeDetail> {
  const existing = await getPromoCode(id)

  const rewritesTerms =
    patch.code !== undefined ||
    patch.kind !== undefined ||
    patch.percentOff !== undefined ||
    patch.amountOffSgd !== undefined
  if (rewritesTerms && existing.redemptionCount > 0) {
    throw new ConflictError('promo_code_terms_frozen')
  }

  let code: string | undefined
  if (patch.code !== undefined) {
    code = normaliseCode(patch.code)
    if (!isValidCode(code)) throw new BadRequestError('promo_code_text_invalid')
  }

  const appliesToAll = patch.appliesToAll ?? existing.code.appliesToAll
  const products =
    patch.products ??
    (patch.appliesToAll === undefined
      ? existing.products.map(p => ({ productType: p.productType, productId: p.productId }))
      : [])
  assertScopeShape(appliesToAll, products)
  await assertProductsExist(products)

  try {
    await db.transaction(async tx => {
      await tx
        .update(promoCodes)
        .set({
          ...(code !== undefined ? { code } : {}),
          ...(patch.kind !== undefined
            ? moneyFields({
                kind: patch.kind,
                percentOff: patch.percentOff,
                amountOffSgd: patch.amountOffSgd,
              })
            : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.maxRedemptions !== undefined
            ? { maxRedemptions: patch.maxRedemptions }
            : {}),
          ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
          appliesToAll,
          updatedAt: new Date(),
        })
        .where(eq(promoCodes.id, id))
      await tx.delete(promoCodeProducts).where(eq(promoCodeProducts.promoCodeId, id))
      await insertScope(tx, id, products)
    })
  } catch (err: unknown) {
    if (isCodeCollision(err)) throw new ConflictError('promo_code_text_taken')
    throw err
  }

  return getPromoCode(id)
}

/**
 * Archiving refuses new Redemptions and leaves held places to lapse. The row
 * is never deleted — the record of what the code did outlives the campaign.
 *
 * One direction only (§11): to stop a code, archive it. There is no un-archive,
 * because a code's terms are frozen once a member has accepted them and
 * reviving one would put those terms back on sale under the same text.
 */
export async function archivePromoCode(id: string): Promise<PromoCodeDetail> {
  const existing = await getPromoCode(id)
  if (existing.code.status === 'archived') {
    throw new BadRequestError('promo_code_already_archived')
  }
  await db
    .update(promoCodes)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(promoCodes.id, id))
  return getPromoCode(id)
}

/**
 * The products a code can be scoped to. Corporate packages are deliberately
 * absent — not an unchecked box, not offerable at all. The Cross-Location
 * Add-On is absent too: it is a rate on Global Policy rather than a product,
 * so there is nothing for a scope row to attach to.
 */
export async function listScopableProducts(): Promise<
  { productType: PromoCodeProduct; productId: string; name: string }[]
> {
  const [classes, pt, ws] = await Promise.all([
    db
      .select({ id: classPackages.id, name: classPackages.name })
      .from(classPackages)
      .where(and(eq(classPackages.status, 'active'), isNull(classPackages.deletedAt))),
    db
      .select({ id: ptPackages.id, name: ptPackages.name })
      .from(ptPackages)
      .where(and(eq(ptPackages.status, 'active'), isNull(ptPackages.deletedAt))),
    db
      .select({ id: workshops.id, name: workshops.name })
      .from(workshops)
      .where(eq(workshops.lifecycle, 'active')),
  ])
  return [
    ...classes.map(r => ({ productType: 'class_package' as const, productId: r.id, name: r.name })),
    ...pt.map(r => ({ productType: 'pt_package' as const, productId: r.id, name: r.name })),
    ...ws.map(r => ({ productType: 'workshop' as const, productId: r.id, name: r.name })),
  ]
}
