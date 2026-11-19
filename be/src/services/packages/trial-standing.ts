import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { entities } from '../../db/schema/catalog'
import { clients } from '../../db/schema/identity'
import { classPackages, clientPackages, ptPackages } from '../../db/schema/packages'
import { ConflictError } from '../../shared/errors'

/**
 * Who may buy a trial, read per Entity (be/CONTEXT.md § Entity, § Trial).
 *
 * A trial is for a member new to its Entity: one trial per Entity, ever, and
 * none once they have held any package of that Entity. Both rules are judged
 * here, by one function, so the checkout pre-gate, the grant every path goes
 * through, and the member Packages page cannot disagree about who is eligible.
 *
 * A held package's Entity is its catalogue source's, read now, so a package
 * moved to another Entity carries what members hold of it (PKG-64), and the
 * answer follows. The rule governs purchases, not moves: a trial moved into an
 * Entity that already has one leaves two there.
 */

/** One package a member holds, reduced to what the trial rules read. */
export interface HeldForTrial {
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  /** Null when no catalogue package is behind it: imported, or its source gone. */
  entityId: string | null
  hasSource: boolean
}

export interface TrialStanding {
  /** The member has held a trial in this Entity, active or expired. */
  used: boolean
  /** The member has held no package at all in this Entity: a trial is for them. */
  eligible: boolean
}

/**
 * Whether a held package counts against `entityId`. It stays out of an Entity
 * only when both Entities are known and differ. A package with no catalogue
 * source (a Mindbody import's) has no Entity to be outside of, so it counts
 * against every Entity: an imported member with a legacy trial does not get a
 * free second one. A catalogue row with no Entity (made before Entities, and
 * only ever in a test) is read the same way on either side.
 */
function countsAgainst(held: HeldForTrial, entityId: string | null): boolean {
  if (!held.hasSource || held.entityId === null || entityId === null) return true
  return held.entityId === entityId
}

/** The two trial facts for one Entity, from what the member holds. */
export function trialStanding(held: readonly HeldForTrial[], entityId: string | null): TrialStanding {
  const here = held.filter(h => countsAgainst(h, entityId))
  return { used: here.some(h => h.kind === 'trial'), eligible: here.length === 0 }
}

/** Every package the client holds, ended ones too, with the Entity of its source. */
export async function heldForTrial(tenantId: string, clientId: string): Promise<HeldForTrial[]> {
  const rows = await db
    .select({
      kind: clientPackages.kind,
      sourceClass: clientPackages.sourceClassPackageId,
      sourcePt: clientPackages.sourcePtPackageId,
      classEntity: classPackages.entityId,
      ptEntity: ptPackages.entityId,
    })
    .from(clientPackages)
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.clientId, clientId)))
  return rows.map(r => ({
    kind: r.kind,
    entityId: r.classEntity ?? r.ptEntity ?? null,
    hasSource: r.sourceClass !== null || r.sourcePt !== null,
  }))
}

/**
 * The checkout pre-gate for a trial, run before any charge: refused
 * `409 trial_already_used` when the member ever held a trial in the trial's
 * Entity, else `409 trial_not_eligible` when they ever held any package of it.
 * Workshops never create a client_packages row, so one does not disqualify.
 */
export async function assertTrialEligible(
  tenantId: string,
  clientId: string,
  trialEntityId: string | null,
): Promise<void> {
  const standing = trialStanding(await heldForTrial(tenantId, clientId), trialEntityId)
  if (standing.used) throw new ConflictError('trial_already_used')
  if (!standing.eligible) throw new ConflictError('trial_not_eligible')
}

/**
 * The guard on the grant itself, which every path that makes a trial goes
 * through (a paid sale, a free or fully discounted one, a Complimentary
 * Package): `409 trial_already_used` when the member already holds a trial in
 * the trial's Entity. Only that rule: being new to the Entity is a condition of
 * buying, and an Admin may comp a trial to a member who has held other packages.
 *
 * It takes the member's row lock first. Nothing else serialises two grants for
 * a member who holds nothing yet (no package row to lock), and it is the only
 * guard now that no index decides the race: the second grant waits here until
 * the first one's request commits, then reads the trial it made. `NO KEY
 * UPDATE`, not `UPDATE`: every client_packages and bookings insert takes `FOR
 * KEY SHARE` on the client through its foreign key, and `UPDATE` would stop
 * them all. The lock lasts as long as the request's Tenant transaction.
 */
export async function assertNoTrialInEntity(
  tenantId: string,
  clientId: string,
  trialEntityId: string | null,
): Promise<void> {
  await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .for('no key update')
  if (trialStanding(await heldForTrial(tenantId, clientId), trialEntityId).used) {
    throw new ConflictError('trial_already_used')
  }
}

/**
 * The trial facts for each live Entity of the studio, by Entity id, for the
 * member Packages page: the page for one Entity reads its own entry.
 */
export async function trialStandingsByEntity(
  tenantId: string,
  clientId: string,
): Promise<Record<string, TrialStanding>> {
  const [live, held] = await Promise.all([
    db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.tenantId, tenantId), isNull(entities.archivedAt)))
      .orderBy(asc(entities.position), asc(entities.createdAt)),
    heldForTrial(tenantId, clientId),
  ])
  return Object.fromEntries(live.map(e => [e.id, trialStanding(held, e.id)]))
}
