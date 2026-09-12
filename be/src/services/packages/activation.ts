/**
 * Activation (spec §3): the moment a Dormant package starts its clock — the
 * first booking it pays for. Every kind waits Dormant from purchase, and one
 * package per family runs at a time; this file is the one place the stamp is
 * written, so the class path and the PT path cannot disagree about it.
 *
 * Both writers already hold the row locked FOR UPDATE inside a transaction.
 * The partial unique indexes on `client_packages` are the backstop: two
 * Activations in one family lose here, not somewhere downstream.
 */
import { and, eq, gt, inArray, isNotNull, lte, ne } from 'drizzle-orm'
import { clientPackages } from '../../db/schema/packages'
import { isUniqueViolation } from '../../db/unique-violation'
import { ConflictError } from '../../shared/errors'
import type { Tx } from './ledger'
import { familyOf, type PackageKind } from './validity'

/**
 * Flip `active` off on the member's own packages whose expiry has passed —
 * the nightly sweep, run early for one member. The one-Activated-per-family
 * index counts a stale `active`, so without this a package that ended at
 * midnight blocks the next one from starting until 01:00.
 */
export async function sweepExpired(
  tx: Tx,
  tenantId: string,
  clientId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(clientPackages)
    .set({ active: false })
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.clientId, clientId),
        eq(clientPackages.active, true),
        isNotNull(clientPackages.expiresAt),
        lte(clientPackages.expiresAt, now),
      ),
    )
}

/**
 * Stamp the expiry on a Dormant package. `expiresAt` was computed by the
 * caller through `activationExpiry`, from the booking moment and the length
 * frozen on the row. A second Activated package in the family trips the
 * index and surfaces as `family_already_activated`.
 */
export async function activatePackage(
  tx: Tx,
  tenantId: string,
  clientPackageId: string,
  expiresAt: Date,
): Promise<void> {
  try {
    await tx
      .update(clientPackages)
      .set({ expiresAt })
      .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw new ConflictError('family_already_activated')
    throw err
  }
}

/**
 * A package that ended by being spent to zero keeps its stamped expiry, and
 * the next booking Activates the one behind it. Credits coming back to the
 * spent package (a cancelled class, an admin top-up) would revive it with
 * that stamp — a second Activated package in the family, which the index
 * refuses. So a revival while another package runs returns the row to
 * Dormant instead: the credits are kept, the package waits its turn, and
 * its clock starts afresh on the day it is next used (§3). Generous, never
 * lost, never a 500.
 *
 * Returns the `active` / `expiresAt` pair the caller must write. When this
 * is not a revival (still active, or still ended), it hands back what it
 * was given.
 */
export async function revivalPatch(
  tx: Tx,
  pkg: {
    tenantId: string
    clientId: string
    id: string
    kind: PackageKind
    active: boolean
    expiresAt: Date | null
  },
  nextActive: boolean,
  now: Date,
): Promise<{ active: boolean; expiresAt: Date | null }> {
  const revived = nextActive && !pkg.active && pkg.expiresAt !== null
  if (!revived) return { active: nextActive, expiresAt: pkg.expiresAt }

  const kinds: PackageKind[] =
    familyOf(pkg.kind) === 'pt' ? ['pt'] : ['credit_bundle', 'unlimited', 'trial']
  const [other] = await tx
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, pkg.tenantId),
        eq(clientPackages.clientId, pkg.clientId),
        ne(clientPackages.id, pkg.id),
        inArray(clientPackages.kind, kinds),
        eq(clientPackages.active, true),
        isNotNull(clientPackages.expiresAt),
        gt(clientPackages.expiresAt, now),
      ),
    )
    .limit(1)

  return other ? { active: true, expiresAt: null } : { active: true, expiresAt: pkg.expiresAt }
}
