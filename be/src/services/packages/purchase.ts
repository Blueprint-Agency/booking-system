import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, classPackages, ptPackages } from '../../db/schema/packages'
import { isUniqueViolation } from '../../db/unique-violation'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { bestPrice, listActivePromotionsFor } from './promotions'
import { PT_VALIDITY_DAYS, addMonths, computeActive } from './validity'

type ClassPackageRow = typeof classPackages.$inferSelect
type PtPackageRow = typeof ptPackages.$inferSelect

/**
 * The client's live Unlimited Plans. Live means active and either Activated with
 * an expiry still ahead, or Dormant and waiting — both are plans the member owns,
 * so a purchase on top of either is a renewal (§3).
 */
async function liveUnlimited(
  clientId: string,
  now: Date,
): Promise<{ expiresAt: Date | null; locationId: string | null }[]> {
  const rows = await db
    .select({ expiresAt: clientPackages.expiresAt, locationId: clientPackages.locationId })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, clientId),
        eq(clientPackages.kind, 'unlimited'),
        eq(clientPackages.active, true),
      ),
    )
  return rows.filter(r => r.expiresAt === null || r.expiresAt > now)
}

type PackageKind = 'credit_bundle' | 'unlimited' | 'trial' | 'pt'

/**
 * The Home Location this purchase lands on — null for every kind that has none.
 * Pure, so the grant and the checkout that precedes it apply exactly the same
 * rules (§1, §6).
 *
 * A renewal must sit at the Home Location of the plan it renews. That is what
 * keeps a member's two plans at one Location, which is in turn what stops
 * booking from reaching past an Activated plan to a Dormant one and running two
 * Activated plans into the partial unique index. A plan bought after the old one
 * has ended is a fresh purchase and picks freely.
 */
export function locationForPurchase(
  kind: PackageKind,
  locationId: string | null | undefined,
  liveUnlimitedLocations: (string | null)[],
): string | null {
  if (kind !== 'unlimited') {
    if (locationId) throw new BadRequestError('location_only_applies_to_unlimited')
    return null
  }
  if (!locationId) throw new BadRequestError('unlimited_requires_location')
  if (liveUnlimitedLocations.some(l => l !== null && l !== locationId)) {
    throw new ConflictError('unlimited_renewal_location_mismatch')
  }
  return locationId
}

/**
 * `locationForPurchase` against the client's live plans. Checkout calls this
 * BEFORE Stripe: the grant applies the same rules, but only once the webhook
 * fires, and a refusal there charges a member for nothing.
 */
export async function assertPurchasableLocation(
  clientId: string,
  kind: PackageKind,
  locationId: string | null | undefined,
): Promise<void> {
  const live = kind === 'unlimited' ? await liveUnlimited(clientId, new Date()) : []
  locationForPurchase(kind, locationId, live.map(r => r.locationId))
}

/**
 *  - credit_bundle: now + validity_days
 *  - unlimited:     null — a Duration is calendar months, not days, and whether the
 *                   clock starts now or at Activation is a rule this helper cannot
 *                   see (§3/§4). `grantPackage` decides and stamps it.
 *  - trial:         now + validity_days (now required by the catalogue check)
 *  - pt:            now + PT_VALIDITY_DAYS (365)
 */
function computeExpiry(
  kind: PackageKind,
  src: ClassPackageRow | PtPackageRow,
  now: Date,
): Date | null {
  if (kind === 'pt') {
    const d = new Date(now)
    d.setDate(d.getDate() + PT_VALIDITY_DAYS)
    return d
  }
  if (kind === 'unlimited') return null
  const days = (src as ClassPackageRow).validityDays
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
  /**
   * Home Location — the one Location an Unlimited Plan Covers (§1). Required for
   * `unlimited` and refused for every other kind. Picking it at checkout is #23;
   * this is the grant path that stores whatever was picked.
   */
  locationId?: string | null
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

  // Idempotency — if a package was already granted for this Stripe payment
  // intent, return it instead of inserting a duplicate. The webhook and the
  // confirmation-page sync-session fallback can both fire for one purchase.
  if (input.paymentIntentId) {
    const [existing] = await db
      .select({ id: clientPackages.id })
      .from(clientPackages)
      .where(eq(clientPackages.stripePaymentIntentId, input.paymentIntentId))
      .limit(1)
    if (existing) return { clientPackageId: existing.id }
  }

  let kind: PackageKind
  let sourceClassPackageId: string | null = null
  let sourcePtPackageId: string | null = null
  let creditsOrSessionsRemaining: number | null = null
  let source: ClassPackageRow | PtPackageRow

  if (input.packageKind === 'class') {
    const [row] = await db
      .select()
      .from(classPackages)
      .where(and(eq(classPackages.id, input.packageId), isNull(classPackages.deletedAt)))
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
      .where(and(eq(ptPackages.id, input.packageId), isNull(ptPackages.deletedAt)))
      .limit(1)
    if (!row) throw new NotFoundError('pt_package_not_found')
    if (row.status !== 'active') throw new BadRequestError('pt_package_not_active')
    source = row
    kind = 'pt'
    sourcePtPackageId = row.id
    creditsOrSessionsRemaining = row.numSessions
  }

  let expiresAt = computeExpiry(kind, source, now)
  let durationMonths: number | null = null

  const live = kind === 'unlimited' ? await liveUnlimited(input.clientId, now) : []
  const locationId = locationForPurchase(kind, input.locationId, live.map(r => r.locationId))

  if (kind === 'unlimited') {
    const cs = source as ClassPackageRow
    if (cs.durationMonths == null) throw new BadRequestError('unlimited_requires_duration_months')
    // Frozen at purchase (§4). The live catalogue row is admin-editable, so
    // re-reading it at Activation would silently relengthen every plan sold.
    durationMonths = cs.durationMonths
    // §3: the clock starts at purchase only when nothing is already live.
    // Otherwise the plan is stored Dormant (null expiry) and the first confirmed
    // class booking it pays for starts it — that stamping is #25's booking path.
    expiresAt = live.length > 0 ? null : addMonths(now, durationMonths)
  }

  try {
    const [row] = await db
      .insert(clientPackages)
      .values({
        clientId: input.clientId,
        kind,
        sourceClassPackageId,
        sourcePtPackageId,
        appliedPromotionId: input.appliedPromotionId ?? null,
        locationId,
        durationMonths,
        creditsOrSessionsRemaining,
        expiresAt,
        active: computeActive({ kind, expiresAt, creditsOrSessionsRemaining }, now),
        amountPaidSgd: input.amountSgd,
        // Frozen List Price (§15) — the catalogue price at purchase, NOT NULL on
        // every row. A comp grant or a $0 trial records the real price against
        // zero paid so it reads as a 100% discount instead of vanishing.
        // Discount is always derived (list minus paid); nothing stores it.
        listPriceSgd: source.priceSgd,
        stripePaymentIntentId: input.paymentIntentId,
      })
      .returning({ id: clientPackages.id })
    return { clientPackageId: row!.id }
  } catch (err: unknown) {
    if (kind === 'trial' && isUniqueViolation(err, 'client_packages_trial_unique_per_client')) {
      throw new ConflictError('trial_already_used')
    }
    throw err
  }
}

/**
 * Trial-pass eligibility gate (fe-client-features.md §6.1). A trial pass is for
 * brand-new members only: the client must have NO packages of any kind yet, and
 * may claim a trial only once ever. Workshops never create a client_packages row,
 * so a prior workshop booking does NOT disqualify the client.
 *
 * Runs BEFORE creating a Stripe Checkout session so a priced trial never charges
 * an ineligible client. The partial-unique index on client_packages remains the
 * final backstop against a race.
 *
 *   409 trial_already_used  — client has claimed a trial before (active or expired)
 *   409 trial_not_eligible  — client already owns some other package (bundle/unlimited/pt)
 */
export async function assertTrialEligible(clientId: string): Promise<void> {
  const rows = await db
    .select({ kind: clientPackages.kind })
    .from(clientPackages)
    .where(eq(clientPackages.clientId, clientId))
  if (rows.length === 0) return
  if (rows.some(r => r.kind === 'trial')) {
    throw new ConflictError('trial_already_used')
  }
  throw new ConflictError('trial_not_eligible')
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
    .where(and(eq(classPackages.id, classPackageId), isNull(classPackages.deletedAt)))
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
