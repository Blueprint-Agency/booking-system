import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { entities } from '../../db/schema/catalog'
import { clients } from '../../db/schema/identity'
import { classPackages, clientPackages, ptPackages } from '../../db/schema/packages'
import { ConflictError } from '../../shared/errors'
import { heldPackageEntityId } from '../catalog/entities'
import { entitiesMatch } from '../catalog/entity-rules'

/**
 * Who may buy a trial, read per Entity and per Trial Type (be/CONTEXT.md
 * § Entity, § Trial).
 *
 * A trial is a package of its parent's kind with the trial box ticked: a Credit
 * Bundle, an Unlimited Plan, a PT 1on1 or a PT 2on1 package. Its **Trial Type**
 * is what it is a first taste of: group classes (a Credit Bundle or Unlimited
 * trial), private 1on1, or private 2on1. A trial is for a member new to that
 * type in its Entity: one trial per type per Entity, ever, and none once they
 * have held any package of that type there. A Pilates group regular may still
 * take the Pilates 1on1 trial; a Yoga member may still take any Pilates trial.
 * Both rules are judged here, by one function, so the checkout pre-gate, the
 * grant every path goes through, and the member Packages page cannot disagree
 * about who is eligible.
 *
 * A held package's Entity is its catalogue source's, read now, so a package
 * moved to another Entity carries what members hold of it (PKG-64), and the
 * answer follows. The rule governs purchases, not moves: a trial moved into an
 * Entity that already has one leaves two there.
 */

/** What a trial is a first taste of. */
export type TrialType = 'group' | '1on1' | '2on1'
export const TRIAL_TYPES: readonly TrialType[] = ['group', '1on1', '2on1']

/** One package a member holds, reduced to what the trial rules read. */
export interface HeldForTrial {
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  /** Sold as a trial (`client_packages.is_trial`). */
  isTrial: boolean
  /** A PT package's 1on1 or 2on1, from its catalogue source; null on a class package or with no source. */
  sessionType: '1on1' | '2on1' | null
  /** Null when no catalogue package is behind it: imported, or its source gone. */
  entityId: string | null
  hasSource: boolean
}

export interface TrialStanding {
  /** The member has held a trial of this type in this Entity, active or expired. */
  used: boolean
  /** The member has held no package of this type in this Entity: a trial is for them. */
  eligible: boolean
}

/** The Trial Type a catalogue package would sell as: a class package's is group, a PT package's its session type. */
export function trialTypeOf(pkg: { kind: 'class' } | { kind: 'pt'; sessionType: '1on1' | '2on1' }): TrialType {
  return pkg.kind === 'class' ? 'group' : pkg.sessionType
}

/**
 * Whether a held package is of `type`. A PT package with no catalogue source
 * (a Mindbody import's) has no session type to read, so it counts as both, as
 * it counts against every Entity below.
 */
function isOfType(held: HeldForTrial, type: TrialType): boolean {
  if (held.kind !== 'pt') return type === 'group'
  return held.sessionType === null ? type !== 'group' : held.sessionType === type
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
  return !held.hasSource || entitiesMatch(held.entityId, entityId)
}

/** The two trial facts for one Entity and one Trial Type, from what the member holds. */
export function trialStanding(
  held: readonly HeldForTrial[],
  entityId: string | null,
  type: TrialType,
): TrialStanding {
  const here = held.filter(h => countsAgainst(h, entityId) && isOfType(h, type))
  return { used: here.some(h => h.isTrial), eligible: here.length === 0 }
}

/** Every package the client holds, ended ones too, with the Entity and session type of its source. */
export async function heldForTrial(tenantId: string, clientId: string): Promise<HeldForTrial[]> {
  const rows = await db
    .select({
      kind: clientPackages.kind,
      isTrial: clientPackages.isTrial,
      sourceClass: clientPackages.sourceClassPackageId,
      sourcePt: clientPackages.sourcePtPackageId,
      sessionType: ptPackages.sessionType,
      entityId: heldPackageEntityId,
    })
    .from(clientPackages)
    .leftJoin(
      classPackages,
      and(eq(classPackages.id, clientPackages.sourceClassPackageId), eq(classPackages.tenantId, tenantId)),
    )
    .leftJoin(ptPackages, and(eq(ptPackages.id, clientPackages.sourcePtPackageId), eq(ptPackages.tenantId, tenantId)))
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.clientId, clientId)))
  return rows.map(r => ({
    kind: r.kind,
    isTrial: r.isTrial,
    sessionType: r.sessionType ?? null,
    entityId: r.entityId ?? null,
    hasSource: r.sourceClass !== null || r.sourcePt !== null,
  }))
}

/**
 * The checkout pre-gate for a trial, run before any charge: refused
 * `409 trial_already_used` when the member ever held a trial of its type in its
 * Entity, else `409 trial_not_eligible` when they ever held any package of that
 * type there. Workshops never create a client_packages row, so one does not
 * disqualify.
 */
export async function assertTrialEligible(
  tenantId: string,
  clientId: string,
  trialEntityId: string | null,
  type: TrialType,
): Promise<void> {
  const standing = trialStanding(await heldForTrial(tenantId, clientId), trialEntityId, type)
  if (standing.used) throw new ConflictError('trial_already_used')
  if (!standing.eligible) throw new ConflictError('trial_not_eligible')
}

/**
 * The guard on the grant itself, which every path that makes a trial goes
 * through (a paid sale, a free or fully discounted one, a Complimentary
 * Package): `409 trial_already_used` when the member already holds a trial of
 * its type in its Entity. Only that rule: being new to the type is a condition
 * of buying, and an Admin may comp a trial to a member who has held other
 * packages.
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
  type: TrialType,
): Promise<void> {
  await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .for('no key update')
  if (trialStanding(await heldForTrial(tenantId, clientId), trialEntityId, type).used) {
    throw new ConflictError('trial_already_used')
  }
}

/**
 * The trial facts for each live Entity of the studio, by Entity id and then by
 * Trial Type, for the member Packages page: the page for one Entity reads its
 * own entry, and each tab the type its trials are.
 */
export async function trialStandingsByEntity(
  tenantId: string,
  clientId: string,
): Promise<Record<string, Record<TrialType, TrialStanding>>> {
  const [live, held] = await Promise.all([
    db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.tenantId, tenantId), isNull(entities.archivedAt)))
      .orderBy(asc(entities.position), asc(entities.createdAt)),
    heldForTrial(tenantId, clientId),
  ])
  return Object.fromEntries(
    live.map(e => [
      e.id,
      Object.fromEntries(TRIAL_TYPES.map(t => [t, trialStanding(held, e.id, t)])) as Record<TrialType, TrialStanding>,
    ]),
  )
}
