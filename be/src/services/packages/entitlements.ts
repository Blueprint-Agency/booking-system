import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, classPackages, ptPackages } from '../../db/schema/packages'

export interface ClientEntitlements {
  trialUsed: boolean
  hasActiveUnlimited: boolean
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
      kind: clientPackages.kind,
      active: clientPackages.active,
      expiresAt: clientPackages.expiresAt,
      remaining: clientPackages.creditsOrSessionsRemaining,
      ptSessionType: ptPackages.sessionType,
    })
    .from(clientPackages)
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .where(eq(clientPackages.clientId, clientId))

  let trialUsed = false
  let hasActiveUnlimited = false
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
      if (consumable) hasActiveUnlimited = true
    } else if (r.kind === 'credit_bundle') {
      if (consumable && balance > 0) hasActiveBundleCredits = true
    } else if (r.kind === 'pt') {
      if (consumable && balance > 0) {
        if (r.ptSessionType === '2on1') pt2on1Remaining += balance
        else pt1on1Remaining += balance
      }
    }
  }

  return { trialUsed, hasActiveUnlimited, hasActiveBundleCredits, pt1on1Remaining, pt2on1Remaining }
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
  active: boolean
  /** '1on1' | '2on1' for PT packages; null otherwise. */
  sessionType: '1on1' | '2on1' | null
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
      classPackageName: classPackages.name,
      ptPackageName: ptPackages.name,
      classPackageCredits: classPackages.credits,
      ptPackageSessions: ptPackages.numSessions,
      active: clientPackages.active,
      ptSessionType: ptPackages.sessionType,
    })
    .from(clientPackages)
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
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
    active: r.active,
    sessionType: (r.ptSessionType ?? null) as '1on1' | '2on1' | null,
  }))
}
