import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, classPackages, promoCodes, ptPackages } from '../../db/schema/packages'
import { locations } from '../../db/schema/catalog'
import { isDormant } from './validity'
import { readCrossLocationRateSgd } from './purchase'

export interface ClientEntitlements {
  trialUsed: boolean
  /** Trial is for brand-new members only: true iff the client owns NO packages yet. */
  trialEligible: boolean
  hasActiveUnlimited: boolean
  /**
   * Home Location of the Unlimited Plan that would pay for a booking today (§8).
   * Null when the client holds none. The renewal rule keeps a member's two plans
   * at one Location, so this is unambiguous.
   */
  unlimitedLocation: { id: string; name: string } | null
  /**
   * The plan a **Cross-Location Add-On** would attach to — the same plan
   * `unlimitedLocation` names. Null when the client holds none. An Add-On belongs
   * to one plan, so the member surfaces need the plan's id to buy one (§5).
   */
  unlimitedPlanId: string | null
  /**
   * That plan already carries an Add-On, so it **Covers** both Locations. Derived
   * here and nowhere else — the schedule's coverage check is a commented mirror,
   * and `covers()` in `selection.ts` stays the enforcement.
   */
  unlimitedCoversBoth: boolean
  /** The Add-On rate as it stands right now, so the member surfaces can quote it (§5). */
  crossLocationRateSgd: string
  /**
   * True when the client holds a Dormant Unlimited Plan — bought, paid for, clock
   * not yet started. Derived HERE and nowhere else: neither frontend gets to test
   * "unlimited and no end date" for itself (§8).
   */
  dormant: boolean
  hasActiveBundleCredits: boolean
  pt1on1Remaining: number
  pt2on1Remaining: number
}

/**
 * One round-trip summary used by the client catalog to decide whether to
 * surface trial-pass / disable bundle while unlimited is active / etc.
 *
 * "Active" means: not expired AND (for credit/pt) credits_or_sessions_remaining > 0.
 */
export async function getClientEntitlements(clientId: string): Promise<ClientEntitlements> {
  const now = new Date()

  const rows = await db
    .select({
      id: clientPackages.id,
      kind: clientPackages.kind,
      active: clientPackages.active,
      expiresAt: clientPackages.expiresAt,
      remaining: clientPackages.creditsOrSessionsRemaining,
      ptSessionType: ptPackages.sessionType,
      locationId: clientPackages.locationId,
      locationName: locations.name,
      crossLocationPaidSgd: clientPackages.crossLocationPaidSgd,
    })
    .from(clientPackages)
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .leftJoin(locations, eq(locations.id, clientPackages.locationId))
    .where(eq(clientPackages.clientId, clientId))

  let trialUsed = false
  let hasActiveUnlimited = false
  let unlimitedLocation: ClientEntitlements['unlimitedLocation'] = null
  let unlimitedPlanId: string | null = null
  let unlimitedCoversBoth = false
  let locationIsDormant = false
  let dormant = false
  let hasActiveBundleCredits = false
  let pt1on1Remaining = 0
  let pt2on1Remaining = 0

  for (const r of rows) {
    // active is authoritative; the live expiry check covers cron lag.
    const consumable = r.active && (r.expiresAt === null || r.expiresAt > now)
    const balance = r.remaining ?? 0
    if (r.kind === 'trial') {
      trialUsed = true // any trial ever (active or expired) counts as used
      if (consumable && balance > 0) hasActiveBundleCredits = true
    } else if (r.kind === 'unlimited') {
      if (consumable) {
        hasActiveUnlimited = true
        if (isDormant({ kind: 'unlimited', expiresAt: r.expiresAt })) dormant = true
        // §3 orders Activated first, Dormant last — the plan paying today is the
        // one with a running clock. The §6 renewal rule keeps a member's two plans
        // at one Location anyway, so this only settles the tie-break.
        if (r.locationId && r.locationName && (unlimitedLocation === null || locationIsDormant)) {
          unlimitedLocation = { id: r.locationId, name: r.locationName }
          unlimitedPlanId = r.id
          unlimitedCoversBoth = r.crossLocationPaidSgd !== null
          locationIsDormant = r.expiresAt === null
        }
      }
    } else if (r.kind === 'credit_bundle') {
      if (consumable && balance > 0) hasActiveBundleCredits = true
    } else if (r.kind === 'pt') {
      if (consumable && balance > 0) {
        if (r.ptSessionType === '2on1') pt2on1Remaining += balance
        else pt1on1Remaining += balance
      }
    }
  }

  // Eligible only when the client owns nothing yet (any package kind disqualifies).
  const trialEligible = rows.length === 0

  return {
    trialUsed,
    trialEligible,
    hasActiveUnlimited,
    unlimitedLocation,
    unlimitedPlanId,
    unlimitedCoversBoth,
    crossLocationRateSgd: await readCrossLocationRateSgd(),
    dormant,
    hasActiveBundleCredits,
    pt1on1Remaining,
    pt2on1Remaining,
  }
}

export interface ClientPackageWithSource {
  id: string
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  sourcePackageId: string | null
  packageName: string
  creditsOrSessionsRemaining: number | null
  /** Original allotment from the source package (credits / num_sessions); null for unlimited. */
  creditsOrSessionsTotal: number | null
  expiresAt: Date | null
  purchasedAt: Date
  amountPaidSgd: string
  /** Catalogue price frozen at purchase (§15). Money off is derived: list minus paid. */
  listPriceSgd: string
  active: boolean
  /** Backend-derived (§8) — a null expiry means Dormant and the frontends never test for it. */
  dormant: boolean
  /** Home Location of an Unlimited Plan (§1); null for every other kind. */
  location: { id: string; name: string } | null
  /** Frozen Duration in calendar months for an Unlimited Plan; null otherwise. */
  durationMonths: number | null
  /** What the member paid for the Cross-Location Add-On (§5); null means Home Location only. */
  crossLocationPaidSgd: string | null
  /** '1on1' | '2on1' for PT packages; null otherwise. */
  sessionType: '1on1' | '2on1' | null
  /** The Promo Code the member typed at purchase, as text; null if none (§11). */
  promoCode: string | null
}

/**
 * Returns the client's package wallet, joined with the source package name so
 * the client app can render it without an extra round-trip.
 */
export async function listClientPackages(
  clientId: string,
  onlyActive = false,
): Promise<ClientPackageWithSource[]> {
  const now = new Date()
  const baseConds = [eq(clientPackages.clientId, clientId)]
  if (onlyActive) baseConds.push(eq(clientPackages.active, true))

  const rows = await db
    .select({
      id: clientPackages.id,
      kind: clientPackages.kind,
      sourceClassPackageId: clientPackages.sourceClassPackageId,
      sourcePtPackageId: clientPackages.sourcePtPackageId,
      creditsOrSessionsRemaining: clientPackages.creditsOrSessionsRemaining,
      expiresAt: clientPackages.expiresAt,
      purchasedAt: clientPackages.purchasedAt,
      amountPaidSgd: clientPackages.amountPaidSgd,
      listPriceSgd: clientPackages.listPriceSgd,
      durationMonths: clientPackages.durationMonths,
      crossLocationPaidSgd: clientPackages.crossLocationPaidSgd,
      locationId: clientPackages.locationId,
      locationName: locations.name,
      classPackageName: classPackages.name,
      ptPackageName: ptPackages.name,
      classPackageCredits: classPackages.credits,
      ptPackageSessions: ptPackages.numSessions,
      active: clientPackages.active,
      ptSessionType: ptPackages.sessionType,
      promoCode: promoCodes.code,
    })
    .from(clientPackages)
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .leftJoin(locations, eq(locations.id, clientPackages.locationId))
    .leftJoin(promoCodes, eq(promoCodes.id, clientPackages.appliedPromoCodeId))
    .where(and(...baseConds))

  return rows.map(r => ({
    id: r.id,
    kind: r.kind as ClientPackageWithSource['kind'],
    sourcePackageId: r.sourceClassPackageId ?? r.sourcePtPackageId,
    packageName: r.classPackageName ?? r.ptPackageName ?? 'Package',
    creditsOrSessionsRemaining: r.creditsOrSessionsRemaining,
    creditsOrSessionsTotal: r.classPackageCredits ?? r.ptPackageSessions ?? null,
    expiresAt: r.expiresAt,
    purchasedAt: r.purchasedAt,
    amountPaidSgd: r.amountPaidSgd,
    listPriceSgd: r.listPriceSgd,
    active: r.active,
    dormant: isDormant({ kind: r.kind as ClientPackageWithSource['kind'], expiresAt: r.expiresAt }),
    location: r.locationId && r.locationName ? { id: r.locationId, name: r.locationName } : null,
    durationMonths: r.durationMonths,
    crossLocationPaidSgd: r.crossLocationPaidSgd,
    sessionType: (r.ptSessionType ?? null) as '1on1' | '2on1' | null,
    promoCode: r.promoCode ?? null,
  }))
}
