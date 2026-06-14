/**
 * Admin edits to a client's package wallet — manual credit/session adjustments,
 * absolute balance sets, and expiry changes. Every change writes a
 * manual_adjustments ledger row (delta=0 for expiry-only edits). See be-portal.md §3d.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'
import { manualAdjustments } from '../../db/schema/ledger'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { computeActive } from './validity'

export type ClientPackageRow = typeof clientPackages.$inferSelect

async function loadOwnedPackage(clientId: string, clientPackageId: string): Promise<ClientPackageRow> {
  const [row] = await db
    .select()
    .from(clientPackages)
    .where(and(eq(clientPackages.id, clientPackageId), eq(clientPackages.clientId, clientId)))
    .limit(1)
  if (!row) throw new NotFoundError('client_package_not_found')
  return row
}

export interface AdjustInput {
  clientId: string
  clientPackageId: string
  delta: number
  reason: string
  actedByStaffId: string
}

/**
 * Apply a signed delta to credits_or_sessions_remaining and log it. Blocks
 * adjustments on unlimited packages (no balance) and any result below zero.
 */
export async function adjustBalance(input: AdjustInput): Promise<ClientPackageRow> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new BadRequestError('delta_must_be_nonzero_integer')
  }
  if (!input.reason.trim()) throw new BadRequestError('reason_required')

  return db.transaction(async tx => {
    const [pkg] = await tx
      .select()
      .from(clientPackages)
      .where(
        and(eq(clientPackages.id, input.clientPackageId), eq(clientPackages.clientId, input.clientId)),
      )
      .limit(1)
    if (!pkg) throw new NotFoundError('client_package_not_found')
    if (pkg.creditsOrSessionsRemaining === null) {
      throw new BadRequestError('cannot_adjust_unlimited_package')
    }
    const next = pkg.creditsOrSessionsRemaining + input.delta
    if (next < 0) throw new BadRequestError('balance_cannot_go_negative')

    // Recompute the consumable flag — adding credits to an exhausted bundle must
    // reactivate it, and zeroing one must deactivate it, without waiting for the
    // nightly expiry sweep.
    const nextActive = computeActive({
      kind: pkg.kind,
      expiresAt: pkg.expiresAt,
      creditsOrSessionsRemaining: next,
    })

    await tx
      .update(clientPackages)
      .set({ creditsOrSessionsRemaining: next, active: nextActive })
      .where(eq(clientPackages.id, pkg.id))

    await tx.insert(manualAdjustments).values({
      clientId: input.clientId,
      clientPackageId: pkg.id,
      delta: input.delta,
      reason: input.reason.trim(),
      actedByStaffId: input.actedByStaffId,
    })

    return { ...pkg, creditsOrSessionsRemaining: next, active: nextActive }
  })
}

export interface SetBalanceInput {
  clientId: string
  clientPackageId: string
  balance: number
  reason: string
  actedByStaffId: string
}

/**
 * Set an absolute balance. Computed as a delta against the current value so the
 * ledger stays delta-based; a no-op (delta 0) is rejected.
 */
export async function setBalance(input: SetBalanceInput): Promise<ClientPackageRow> {
  if (!Number.isInteger(input.balance) || input.balance < 0) {
    throw new BadRequestError('balance_must_be_nonnegative_integer')
  }
  const pkg = await loadOwnedPackage(input.clientId, input.clientPackageId)
  if (pkg.creditsOrSessionsRemaining === null) {
    throw new BadRequestError('cannot_set_balance_on_unlimited_package')
  }
  const delta = input.balance - pkg.creditsOrSessionsRemaining
  if (delta === 0) throw new BadRequestError('balance_unchanged')
  return adjustBalance({
    clientId: input.clientId,
    clientPackageId: input.clientPackageId,
    delta,
    reason: `Set ${input.balance}: ${input.reason.trim()}`,
    actedByStaffId: input.actedByStaffId,
  })
}

export interface SetExpiryInput {
  clientId: string
  clientPackageId: string
  /** New expiry as a Date, or null to remove expiry. */
  expiresAt: Date | null
  reason: string
  actedByStaffId: string
}

/**
 * Change a package's expiry (duration). Logged as a delta-0 manual_adjustment
 * with a human-readable reason so it shows in the audit trail.
 */
export async function setPackageExpiry(input: SetExpiryInput): Promise<ClientPackageRow> {
  if (!input.reason.trim()) throw new BadRequestError('reason_required')

  return db.transaction(async tx => {
    const [pkg] = await tx
      .select()
      .from(clientPackages)
      .where(
        and(eq(clientPackages.id, input.clientPackageId), eq(clientPackages.clientId, input.clientId)),
      )
      .limit(1)
    if (!pkg) throw new NotFoundError('client_package_not_found')

    const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'no expiry')
    const reason = `Expiry changed from ${fmt(pkg.expiresAt)} to ${fmt(input.expiresAt)}: ${input.reason.trim()}`

    // Extending an expired package's expiry must make its credits usable again
    // (and shortening it past `now` must deactivate it) — recompute, don't wait
    // for the nightly sweep. `bookClass` filters on `active = true`.
    const nextActive = computeActive({
      kind: pkg.kind,
      expiresAt: input.expiresAt,
      creditsOrSessionsRemaining: pkg.creditsOrSessionsRemaining,
    })

    await tx
      .update(clientPackages)
      .set({ expiresAt: input.expiresAt, active: nextActive })
      .where(eq(clientPackages.id, pkg.id))

    await tx.insert(manualAdjustments).values({
      clientId: input.clientId,
      clientPackageId: pkg.id,
      delta: 0,
      reason,
      actedByStaffId: input.actedByStaffId,
    })

    return { ...pkg, expiresAt: input.expiresAt, active: nextActive }
  })
}
