import { and, eq, gt, gte, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, classPackages, ptPackages } from '../../db/schema/packages'

export interface ClientEntitlements {
  trialUsed: boolean
  hasActiveUnlimited: boolean
  hasActiveBundleCredits: boolean
  ptSessionsRemaining: number
}

/**
 * One round-trip summary used by the client catalog to decide whether to
 * surface trial-pass / disable bundle while unlimited is active / etc.
 *
 * "Active" means: not expired AND (for credit/pt) credits_or_sessions_remaining > 0.
 */
export async function getClientEntitlements(clientId: string): Promise<ClientEntitlements> {
  const now = new Date()

  const rows = await db.select().from(clientPackages).where(eq(clientPackages.clientId, clientId))

  let trialUsed = false
  let hasActiveUnlimited = false
  let hasActiveBundleCredits = false
  let ptSessionsRemaining = 0

  for (const r of rows) {
    const notExpired = r.expiresAt === null || r.expiresAt > now
    if (r.kind === 'trial') {
      // Any trial purchase ever (active or expired) counts as used.
      trialUsed = true
      if (notExpired && (r.creditsOrSessionsRemaining ?? 0) > 0) {
        hasActiveBundleCredits = true
      }
    } else if (r.kind === 'unlimited') {
      if (notExpired) hasActiveUnlimited = true
    } else if (r.kind === 'credit_bundle') {
      if (notExpired && (r.creditsOrSessionsRemaining ?? 0) > 0) hasActiveBundleCredits = true
    } else if (r.kind === 'pt') {
      if (notExpired) ptSessionsRemaining += r.creditsOrSessionsRemaining ?? 0
    }
  }

  return { trialUsed, hasActiveUnlimited, hasActiveBundleCredits, ptSessionsRemaining }
}

export interface ClientPackageWithSource {
  id: string
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  sourcePackageId: string | null
  packageName: string
  creditsOrSessionsRemaining: number | null
  expiresAt: Date | null
  purchasedAt: Date
  amountPaidSgd: string
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
  if (onlyActive) {
    baseConds.push(
      or(isNull(clientPackages.expiresAt), gt(clientPackages.expiresAt, now))!,
    )
  }

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
    expiresAt: r.expiresAt,
    purchasedAt: r.purchasedAt,
    amountPaidSgd: r.amountPaidSgd,
  }))
}
