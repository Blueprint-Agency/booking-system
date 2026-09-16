/**
 * Admin edits to a client's package wallet — manual credit/session adjustments,
 * absolute balance sets, expiry changes, the Cross-Location Add-On, Home
 * Location moves and a PT Package's Bound Instructor. Every change writes a
 * manual_adjustments ledger row (delta=0
 * for every edit that moves no credits). See be-portal.md §3d.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'
import { locations } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { manualAdjustments } from '../../db/schema/ledger'
import { isUniqueViolation } from '../../db/unique-violation'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { listActiveInstructors } from '../schedule/client-catalog'
import { computeActive } from './validity'
import { revivalPatch } from './activation'
import { boundInstructorChange, homeLocationMove, liveUnlimited } from './purchase'

export type ClientPackageRow = typeof clientPackages.$inferSelect

/**
 * The one lookup every edit on this page starts from. Scoped by Tenant as well
 * as owner, so a package id belonging to another studio's member names nothing
 * — the refusal is `client_package_not_found`, the same answer an id that does
 * not exist gets, and nothing about the row leaks.
 */
function ownedPackage(tenantId: string, clientId: string, clientPackageId: string) {
  return and(
    eq(clientPackages.tenantId, tenantId),
    eq(clientPackages.id, clientPackageId),
    eq(clientPackages.clientId, clientId),
  )
}

async function loadOwnedPackage(
  tenantId: string,
  clientId: string,
  clientPackageId: string,
): Promise<ClientPackageRow> {
  const [row] = await db
    .select()
    .from(clientPackages)
    .where(ownedPackage(tenantId, clientId, clientPackageId))
    .limit(1)
  if (!row) throw new NotFoundError('client_package_not_found')
  return row
}

export interface AdjustInput {
  tenantId: string
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
      .where(ownedPackage(input.tenantId, input.clientId, input.clientPackageId))
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
    // Topping up a spent package while the next one in its family runs
    // returns it to Dormant rather than tripping the one-Activated index.
    const patch = await revivalPatch(tx, { ...pkg, clientId: input.clientId }, nextActive, new Date())

    await tx
      .update(clientPackages)
      .set({ creditsOrSessionsRemaining: next, ...patch })
      .where(and(eq(clientPackages.tenantId, input.tenantId), eq(clientPackages.id, pkg.id)))

    await tx.insert(manualAdjustments).values({
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientPackageId: pkg.id,
      delta: input.delta,
      reason: input.reason.trim(),
      actedByStaffId: input.actedByStaffId,
    })

    return { ...pkg, creditsOrSessionsRemaining: next, ...patch }
  })
}

export interface SetBalanceInput {
  tenantId: string
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
  const pkg = await loadOwnedPackage(input.tenantId, input.clientId, input.clientPackageId)
  if (pkg.creditsOrSessionsRemaining === null) {
    throw new BadRequestError('cannot_set_balance_on_unlimited_package')
  }
  const delta = input.balance - pkg.creditsOrSessionsRemaining
  if (delta === 0) throw new BadRequestError('balance_unchanged')
  return adjustBalance({
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientPackageId: input.clientPackageId,
    delta,
    reason: `Set ${input.balance}: ${input.reason.trim()}`,
    actedByStaffId: input.actedByStaffId,
  })
}

export interface SetCrossLocationInput {
  tenantId: string
  clientId: string
  clientPackageId: string
  /** The amount the Add-On is recorded at, or null to remove it. */
  paidSgd: string | null
  reason: string
  actedByStaffId: string
}

/**
 * Staff attach or remove a **Cross-Location Add-On** (§5). Logged as a delta-0
 * manual_adjustment carrying the reason, exactly how an expiry-only edit is
 * already recorded — the correction path for a member who paid at the counter or
 * was charged in error.
 */
export async function setCrossLocationAddOn(
  input: SetCrossLocationInput,
): Promise<ClientPackageRow> {
  if (!input.reason.trim()) throw new BadRequestError('reason_required')

  return db.transaction(async tx => {
    const [pkg] = await tx
      .select()
      .from(clientPackages)
      .where(ownedPackage(input.tenantId, input.clientId, input.clientPackageId))
      .limit(1)
    if (!pkg) throw new NotFoundError('client_package_not_found')
    // Only an Unlimited Plan has a Home Location to extend.
    if (pkg.kind !== 'unlimited') throw new BadRequestError('cross_location_requires_unlimited')

    const reason =
      input.paidSgd === null
        ? `Cross-Location Add-On removed: ${input.reason.trim()}`
        : `Cross-Location Add-On added at $${input.paidSgd}: ${input.reason.trim()}`

    await tx
      .update(clientPackages)
      .set({ crossLocationPaidSgd: input.paidSgd })
      .where(and(eq(clientPackages.tenantId, input.tenantId), eq(clientPackages.id, pkg.id)))

    await tx.insert(manualAdjustments).values({
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientPackageId: pkg.id,
      delta: 0,
      reason,
      actedByStaffId: input.actedByStaffId,
    })

    return { ...pkg, crossLocationPaidSgd: input.paidSgd }
  })
}

export interface SetHomeLocationInput {
  tenantId: string
  clientId: string
  clientPackageId: string
  /** The Location the member is moved to. */
  locationId: string
  reason: string
  actedByStaffId: string
}

/**
 * Move a member's **Home Location** (§7). Admin only, audited, no frequency
 * limit — the correction for a member who picked the wrong Location at checkout,
 * whose only other route out is a refund and a repurchase.
 *
 * The move takes the member's Activated plan **and** any Dormant renewal in one
 * transaction: `homeLocationMove` decides which, so the rule that keeps two live
 * plans agreeing sits beside the purchase rule it mirrors.
 *
 * Bookings are deliberately untouched, including bookings at the Location being
 * left — correcting a record does not cancel a member's classes.
 */
export async function setHomeLocation(input: SetHomeLocationInput): Promise<ClientPackageRow> {
  if (!input.reason.trim()) throw new BadRequestError('reason_required')

  return db.transaction(async tx => {
    const [pkg] = await tx
      .select()
      .from(clientPackages)
      .where(ownedPackage(input.tenantId, input.clientId, input.clientPackageId))
      .limit(1)
    if (!pkg) throw new NotFoundError('client_package_not_found')

    // Somewhere real, and somewhere classes can still be scheduled — moving a
    // member onto an archived Location strands them exactly as the wrong
    // Location already has.
    const [to] = await tx
      .select({ id: locations.id, name: locations.name, archivedAt: locations.archivedAt })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, input.tenantId),
          eq(locations.id, input.locationId),
          isNull(locations.deletedAt),
        ),
      )
      .limit(1)
    if (!to) throw new NotFoundError('location_not_found')
    if (to.archivedAt) throw new BadRequestError('location_archived')

    // The same set a renewal is counted against (§6) — read through the
    // transaction's own handle, and never re-derived here.
    const live = await liveUnlimited(input.tenantId, input.clientId, new Date(), tx)

    const move = homeLocationMove(pkg.kind, pkg.id, live, input.locationId)
    if (!move.ok) throw new BadRequestError(move.refusal)

    // Both Locations by name, per plan. There are two studios, so reading the
    // lot costs nothing — and each row states where *that* plan was, which is
    // the whole point on the day two plans disagree.
    const names = new Map(
      (
        await tx
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(eq(locations.tenantId, input.tenantId))
      ).map(l => [l.id, l.name]),
    )
    const wasAt = new Map(live.map(p => [p.id, p.locationId]))

    await tx
      .update(clientPackages)
      .set({ locationId: input.locationId })
      .where(
        and(
          eq(clientPackages.tenantId, input.tenantId),
          inArray(clientPackages.id, move.moveIds),
        ),
      )

    // One ledger row per plan moved — the Dormant renewal moved too, and an
    // audit trail that only names one of them hides half the change.
    await tx.insert(manualAdjustments).values(
      move.moveIds.map(id => ({
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientPackageId: id,
        delta: 0,
        reason: `Home Location changed from ${names.get(wasAt.get(id) ?? '') ?? 'unknown'} to ${to.name}: ${input.reason.trim()}`,
        actedByStaffId: input.actedByStaffId,
      })),
    )

    return { ...pkg, locationId: input.locationId }
  })
}

export interface SetBoundInstructorInput {
  tenantId: string
  clientId: string
  clientPackageId: string
  /** The instructor the package is bound to, or null to reopen it to anyone. */
  instructorId: string | null
  reason: string
  actedByStaffId: string
}

/**
 * Bind, move or clear a purchased PT Package's **Bound Instructor** (#110) —
 * the admin-side counterpart to the choice a member makes at checkout, for a
 * package sold open, a member changing coach, or a coach who has left.
 *
 * Sessions already on the calendar are deliberately untouched, exactly as a
 * Home Location move leaves bookings standing: the binding decides who may pick
 * up FUTURE requests, and rewriting a scheduled session under an instructor is
 * a different act with different consequences.
 *
 * The refusals live in `boundInstructorChange` beside the purchase rule, so the
 * dialog and the route stay presentation and plumbing.
 */
export async function setBoundInstructor(
  input: SetBoundInstructorInput,
): Promise<ClientPackageRow> {
  if (!input.reason.trim()) throw new BadRequestError('reason_required')

  return db.transaction(async tx => {
    const [pkg] = await tx
      .select()
      .from(clientPackages)
      .where(ownedPackage(input.tenantId, input.clientId, input.clientPackageId))
      .limit(1)
    if (!pkg) throw new NotFoundError('client_package_not_found')

    // The Tenant's active instructors, read only when there is a pick to check
    // against them — clearing a binding needs no roster. Same set the checkout
    // picker is fed from, so the two paths refuse the same people. Read through
    // the transaction's own handle: tenant context is transaction-local, so a
    // read on another pooled connection is outside it.
    const roster = input.instructorId
      ? (await listActiveInstructors(input.tenantId, tx)).map(i => i.id)
      : []

    const change = boundInstructorChange(pkg.kind, pkg.boundInstructorId, input.instructorId, roster)
    if (!change.ok) throw new BadRequestError(change.refusal)

    // Both names, read by id and not filtered on status: the instructor being
    // moved AWAY from may well be archived by now, and an audit row that calls
    // them "unknown" loses the only record of who the sessions were with.
    const ids = [pkg.boundInstructorId, change.instructorId].filter((v): v is string => v !== null)
    const names = new Map(
      ids.length
        ? (
            await tx
              .select({ id: staffUsers.id, name: staffUsers.name })
              .from(staffUsers)
              .where(and(eq(staffUsers.tenantId, input.tenantId), inArray(staffUsers.id, ids)))
          ).map(s => [s.id, s.name || 'Instructor'])
        : [],
    )
    const who = (id: string | null) => (id ? (names.get(id) ?? 'unknown') : 'anyone')
    const reason = `Bound instructor changed from ${who(pkg.boundInstructorId)} to ${who(change.instructorId)}: ${input.reason.trim()}`

    await tx
      .update(clientPackages)
      .set({ boundInstructorId: change.instructorId })
      .where(and(eq(clientPackages.tenantId, input.tenantId), eq(clientPackages.id, pkg.id)))

    await tx.insert(manualAdjustments).values({
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientPackageId: pkg.id,
      delta: 0,
      reason,
      actedByStaffId: input.actedByStaffId,
    })

    return { ...pkg, boundInstructorId: change.instructorId }
  })
}

export interface SetExpiryInput {
  tenantId: string
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
      .where(ownedPackage(input.tenantId, input.clientId, input.clientPackageId))
      .limit(1)
    if (!pkg) throw new NotFoundError('client_package_not_found')

    // A blank expiry returns the package to Dormant (§8) — the escape hatch the
    // one-way activation rule depends on, the way an admin undoes an Activation
    // caused by a class the studio itself cancelled. Every kind can be Dormant.
    // A null expiry means Dormant and nothing else — "no expiry" has left the domain.
    const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'Dormant')
    const reason = `Expiry changed from ${fmt(pkg.expiresAt)} to ${fmt(input.expiresAt)}: ${input.reason.trim()}`

    // Extending an expired package's expiry must make its credits usable again
    // (and shortening it past `now` must deactivate it) — recompute, don't wait
    // for the nightly sweep. `bookClass` filters on `active = true`.
    const nextActive = computeActive({
      kind: pkg.kind,
      expiresAt: input.expiresAt,
      creditsOrSessionsRemaining: pkg.creditsOrSessionsRemaining,
    })

    // Giving a Dormant package a date IS an Activation by hand, and the
    // one-per-family index applies to staff too: two running in a family is
    // the state the whole rule exists to prevent, whoever writes it.
    try {
      await tx
        .update(clientPackages)
        .set({ expiresAt: input.expiresAt, active: nextActive })
        .where(and(eq(clientPackages.tenantId, input.tenantId), eq(clientPackages.id, pkg.id)))
    } catch (err: unknown) {
      if (isUniqueViolation(err)) throw new ConflictError('family_already_activated')
      throw err
    }

    await tx.insert(manualAdjustments).values({
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientPackageId: pkg.id,
      delta: 0,
      reason,
      actedByStaffId: input.actedByStaffId,
    })

    return { ...pkg, expiresAt: input.expiresAt, active: nextActive }
  })
}
