import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classPackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import {
  assertEntityUsable,
  entityForNewPackage,
  entityMoveOf,
  entityScopeForSlug,
} from '../catalog/entities'
import { replacePromotionsForParent, type PromotionWriteInput } from './promotions'

export type ClassPackageRow = typeof classPackages.$inferSelect
/** What a class package is: a trial is a tick on one of these (`isTrial`), not a kind. */
export type ClassPackageKind = 'credit_bundle' | 'unlimited'

export async function listClassPackages(
  tenantId: string,
  opts: {
    status?: 'active' | 'archived'
    kind?: ClassPackageKind
    /** Only trials (true) or only what is not one (false). */
    isTrial?: boolean
    entityId?: string
    /** `?entity=<slug>`: a slug naming no live Entity of the studio lists nothing. */
    entitySlug?: string
  },
): Promise<ClassPackageRow[]> {
  const scope = await entityScopeForSlug(tenantId, opts.entitySlug)
  if (scope === null) return []
  const filters = [eq(classPackages.tenantId, tenantId), isNull(classPackages.deletedAt)]
  if (opts.status) filters.push(eq(classPackages.status, opts.status))
  if (opts.kind) filters.push(eq(classPackages.kind, opts.kind))
  if (opts.isTrial !== undefined) filters.push(eq(classPackages.isTrial, opts.isTrial))
  if (opts.entityId) filters.push(eq(classPackages.entityId, opts.entityId))
  if (scope.entityId) filters.push(eq(classPackages.entityId, scope.entityId))
  return db
    .select()
    .from(classPackages)
    .where(and(...filters))
}

export async function getClassPackage(tenantId: string, id: string): Promise<ClassPackageRow> {
  const [row] = await db
    .select()
    .from(classPackages)
    .where(
      and(
        eq(classPackages.tenantId, tenantId),
        eq(classPackages.id, id),
        isNull(classPackages.deletedAt),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('class_package_not_found')
  return row
}

export interface CreateClassPackageInput {
  name: string
  description?: string | null
  kind: ClassPackageKind
  /** Sold as a trial (be/CONTEXT.md § Trial). Fixed once made, like the kind. */
  isTrial?: boolean
  credits?: number | null
  validityDays?: number | null
  durationMonths?: number | null
  priceSgd: string // numeric, formatted "120.00"
  /** The Entity it is sold under. Left out, it goes in the studio's first live Entity; the admin routes always send it. */
  entityId?: string
}

function validateKindFields(input: CreateClassPackageInput | UpdateClassPackageInput, kind: ClassPackageKind) {
  // A Credit Bundle trial is a Credit Bundle: validity is REQUIRED for it as for
  // any (spec §3). "Never expires" has left the domain: a null expiry now means
  // Dormant, which only an Unlimited Plan can be.
  if (kind === 'credit_bundle') {
    if (input.credits == null || input.validityDays == null) {
      throw new BadRequestError('credit_bundle_requires_credits_and_validity')
    }
    if (input.durationMonths != null) {
      throw new BadRequestError('credit_bundle_disallows_duration_months')
    }
  } else if (kind === 'unlimited') {
    if (input.durationMonths == null) {
      throw new BadRequestError('unlimited_requires_duration_months')
    }
    if (input.credits != null || input.validityDays != null) {
      throw new BadRequestError('unlimited_disallows_credits_or_validity')
    }
  }
}

export async function createClassPackage(
  tenantId: string,
  input: CreateClassPackageInput,
): Promise<ClassPackageRow> {
  validateKindFields(input, input.kind)
  const entityId = await entityForNewPackage(tenantId, input.entityId)
  const [row] = await db
    .insert(classPackages)
    .values({
      tenantId,
      entityId,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind,
      isTrial: input.isTrial ?? false,
      credits: input.credits ?? null,
      validityDays: input.validityDays ?? null,
      durationMonths: input.durationMonths ?? null,
      priceSgd: input.priceSgd,
      status: 'active',
    })
    .returning()
  return row!
}

/**
 * A new package and its Promotions, saved together or not at all: one savepoint,
 * so a Promotion the database refuses takes the package row with it. The request
 * around it commits whatever is left when the route answers an error.
 */
export async function createClassPackageWithPromotions(
  tenantId: string,
  input: CreateClassPackageInput,
  promotions: PromotionWriteInput[],
  actorStaffId: string,
): Promise<ClassPackageRow> {
  return db.transaction(async () => {
    const row = await createClassPackage(tenantId, input)
    if (promotions.length) {
      await replacePromotionsForParent(tenantId, 'class_package', row.id, promotions, actorStaffId)
    }
    return row
  })
}

export interface UpdateClassPackageInput {
  name?: string
  description?: string | null
  priceSgd?: string
  credits?: number | null
  validityDays?: number | null
  durationMonths?: number | null
  status?: 'active' | 'archived'
  /**
   * A move to another Entity. Checked only when it is a change: a package in an
   * Entity since archived can still be edited, and naming the Entity it is
   * already in changes nothing. A move cancels nothing: the packages members
   * hold read their Entity through this one.
   */
  entityId?: string
}

export async function updateClassPackage(
  tenantId: string,
  id: string,
  patch: UpdateClassPackageInput,
): Promise<ClassPackageRow> {
  const current = await getClassPackage(tenantId, id)
  const moveTo = await entityMoveOf(tenantId, current, patch)
  const merged: CreateClassPackageInput = {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    kind: current.kind,
    credits: patch.credits !== undefined ? patch.credits : current.credits,
    validityDays: patch.validityDays !== undefined ? patch.validityDays : current.validityDays,
    durationMonths: patch.durationMonths !== undefined ? patch.durationMonths : current.durationMonths,
    priceSgd: patch.priceSgd ?? current.priceSgd,
  }
  validateKindFields(merged, current.kind)

  const changes = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.priceSgd !== undefined ? { priceSgd: patch.priceSgd } : {}),
    ...(patch.credits !== undefined ? { credits: patch.credits } : {}),
    ...(patch.validityDays !== undefined ? { validityDays: patch.validityDays } : {}),
    ...(patch.durationMonths !== undefined ? { durationMonths: patch.durationMonths } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(moveTo !== undefined ? { entityId: moveTo } : {}),
  }
  // Nothing to change (an edit naming the Entity the package is already in):
  // an empty UPDATE is an error, and the package is as it should be.
  if (Object.keys(changes).length === 0) return current
  const [row] = await db
    .update(classPackages)
    .set(changes)
    .where(and(eq(classPackages.tenantId, tenantId), eq(classPackages.id, id)))
    .returning()
  return row!
}

/**
 * An edit and the Promotions sent with it, saved together or not at all, as
 * `createClassPackageWithPromotions` does: one savepoint, so a Promotion the
 * database refuses takes the package's changes with it. No `promotions` leaves
 * the package's Promotions as they are.
 */
export async function updateClassPackageWithPromotions(
  tenantId: string,
  id: string,
  patch: UpdateClassPackageInput,
  promotions: PromotionWriteInput[] | undefined,
  actorStaffId: string,
): Promise<ClassPackageRow> {
  return db.transaction(async () => {
    const row = await updateClassPackage(tenantId, id, patch)
    if (promotions !== undefined) {
      await replacePromotionsForParent(tenantId, 'class_package', id, promotions, actorStaffId)
    }
    return row
  })
}

export async function archiveClassPackage(
  tenantId: string,
  id: string,
): Promise<ClassPackageRow> {
  const existing = await getClassPackage(tenantId, id)
  if (existing.status === 'archived') {
    throw new BadRequestError('class_package_already_archived')
  }
  const [row] = await db
    .update(classPackages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(and(eq(classPackages.tenantId, tenantId), eq(classPackages.id, id)))
    .returning()
  return row!
}

export async function unarchiveClassPackage(
  tenantId: string,
  id: string,
): Promise<ClassPackageRow> {
  const existing = await getClassPackage(tenantId, id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('class_package_not_archived')
  }
  await assertEntityUsable(tenantId, existing.entityId)
  const [row] = await db
    .update(classPackages)
    .set({ status: 'active', archivedAt: null })
    .where(and(eq(classPackages.tenantId, tenantId), eq(classPackages.id, id)))
    .returning()
  return row!
}

/**
 * Soft-delete a class package. Must be currently archived; the row stays in
 * DB so historical client_packages references keep resolving.
 */
export async function softDeleteClassPackage(tenantId: string, id: string): Promise<void> {
  const existing = await getClassPackage(tenantId, id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('class_package_not_archived')
  }
  await db
    .update(classPackages)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(classPackages.tenantId, tenantId), eq(classPackages.id, id)))
}
