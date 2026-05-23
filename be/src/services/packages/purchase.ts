import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, classPackages, ptPackages } from '../../db/schema/packages'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { bestPrice, listActivePromotionsFor } from './promotions'

type ClassPackageRow = typeof classPackages.$inferSelect
type PtPackageRow = typeof ptPackages.$inferSelect

/**
 *  - credit_bundle: now + validity_days
 *  - unlimited:     now + duration_days
 *  - trial:         now + validity_days (null if validity_days is null)
 *  - pt:            null (no expiry; admin manages)
 */
function computeExpiry(
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt',
  src: ClassPackageRow | PtPackageRow,
  now: Date,
): Date | null {
  if (kind === 'pt') return null
  const cs = src as ClassPackageRow
  let days: number | null = null
  if (kind === 'credit_bundle') days = cs.validityDays
  else if (kind === 'unlimited') days = cs.durationDays
  else if (kind === 'trial') days = cs.validityDays
  if (days == null) return null
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return d
}

export interface GrantPackageInput {
  clientId: string
  /** stripe_payment_intents.id — null for free trial / admin grants */
  paymentIntentId: string | null
  /** amount actually paid in SGD as "120.00" string. "0.00" for free trial. */
  amountSgd: string
  packageKind: 'class' | 'pt'
  /** id of class_packages or pt_packages row */
  packageId: string
  /** frozen promotion id (computed from best-price-wins). null if none applied. */
  appliedPromotionId?: string | null
}

/**
 * Insert a client_packages row from a purchased catalogue package. Used by:
 *  - billing webhook (Stripe-paid purchases)
 *  - free trial pass purchase
 *  - admin complimentary grants
 *
 * Throws ConflictError('trial_already_used') on partial-unique violation.
 */
export async function grantPackage(
  input: GrantPackageInput,
): Promise<{ clientPackageId: string }> {
  const now = new Date()

  let kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  let sourceClassPackageId: string | null = null
  let sourcePtPackageId: string | null = null
  let creditsOrSessionsRemaining: number | null = null
  let source: ClassPackageRow | PtPackageRow

  if (input.packageKind === 'class') {
    const [row] = await db
      .select()
      .from(classPackages)
      .where(eq(classPackages.id, input.packageId))
      .limit(1)
    if (!row) throw new NotFoundError('class_package_not_found')
    if (row.status !== 'active') throw new BadRequestError('class_package_not_active')
    source = row
    kind = row.kind
    sourceClassPackageId = row.id
    creditsOrSessionsRemaining = row.credits ?? null
  } else {
    const [row] = await db
      .select()
      .from(ptPackages)
      .where(eq(ptPackages.id, input.packageId))
      .limit(1)
    if (!row) throw new NotFoundError('pt_package_not_found')
    if (row.status !== 'active') throw new BadRequestError('pt_package_not_active')
    source = row
    kind = 'pt'
    sourcePtPackageId = row.id
    creditsOrSessionsRemaining = row.numSessions
  }

  const expiresAt = computeExpiry(kind, source, now)

  try {
    const [row] = await db
      .insert(clientPackages)
      .values({
        clientId: input.clientId,
        kind,
        sourceClassPackageId,
        sourcePtPackageId,
        appliedPromotionId: input.appliedPromotionId ?? null,
        creditsOrSessionsRemaining,
        expiresAt,
        amountPaidSgd: input.amountSgd,
        stripePaymentIntentId: input.paymentIntentId,
      })
      .returning({ id: clientPackages.id })
    return { clientPackageId: row!.id }
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string }
    const msg = e.message ?? ''
    if (
      msg.includes('client_packages_trial_unique_per_client') ||
      (e.code === '23505' && kind === 'trial')
    ) {
      throw new ConflictError('trial_already_used')
    }
    throw err
  }
}

/**
 * Free trial pass purchase — no Stripe, no payment intent. Reuses grantPackage
 * so the partial-unique index enforces one-trial-per-client.
 */
export async function purchaseFreeTrial(
  clientId: string,
  classPackageId: string,
): Promise<{ clientPackageId: string }> {
  const [pkg] = await db
    .select()
    .from(classPackages)
    .where(eq(classPackages.id, classPackageId))
    .limit(1)
  if (!pkg) throw new NotFoundError('class_package_not_found')
  if (pkg.status !== 'active') throw new BadRequestError('class_package_not_active')
  if (pkg.kind !== 'trial') throw new BadRequestError('not_a_trial_package')

  const promos = await listActivePromotionsFor('class_package', [pkg.id])
  const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
  const finalPrice = Number(eff.effectivePriceSgd)
  if (finalPrice > 0) {
    throw new BadRequestError('trial_is_not_free')
  }

  return grantPackage({
    clientId,
    paymentIntentId: null,
    amountSgd: '0.00',
    packageKind: 'class',
    packageId: pkg.id,
    appliedPromotionId: eff.appliedPromotionId,
  })
}
