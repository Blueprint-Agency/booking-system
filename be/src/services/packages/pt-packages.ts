import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { ptPackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import {
  assertEntityUsable,
  entityForNewPackage,
  entityMoveOf,
  entityScopeForSlug,
} from '../catalog/entities'
import { replacePromotionsForParent, type PromotionWriteInput } from './promotions'

export type PtPackageRow = typeof ptPackages.$inferSelect
export type PtSessionType = '1on1' | '2on1'

export async function listPtPackages(
  tenantId: string,
  opts: {
    status?: 'active' | 'archived'
    sessionType?: PtSessionType
    entityId?: string
    /** `?entity=<slug>`: a slug naming no live Entity of the studio lists nothing. */
    entitySlug?: string
  },
): Promise<PtPackageRow[]> {
  const scope = await entityScopeForSlug(tenantId, opts.entitySlug)
  if (scope === null) return []
  const filters = [eq(ptPackages.tenantId, tenantId), isNull(ptPackages.deletedAt)]
  if (opts.status) filters.push(eq(ptPackages.status, opts.status))
  if (opts.sessionType) filters.push(eq(ptPackages.sessionType, opts.sessionType))
  if (opts.entityId) filters.push(eq(ptPackages.entityId, opts.entityId))
  if (scope.entityId) filters.push(eq(ptPackages.entityId, scope.entityId))
  return db
    .select()
    .from(ptPackages)
    .where(and(...filters))
}

export async function getPtPackage(tenantId: string, id: string): Promise<PtPackageRow> {
  const [row] = await db
    .select()
    .from(ptPackages)
    .where(
      and(eq(ptPackages.tenantId, tenantId), eq(ptPackages.id, id), isNull(ptPackages.deletedAt)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('pt_package_not_found')
  return row
}

export interface CreatePtPackageInput {
  name: string
  sessionType: PtSessionType
  numSessions: number
  /** How long a purchase of this package lasts, in days. Required — a PT package always expires. */
  validityDays: number
  /**
   * Instructor-Bound — a member buying this package picks one active
   * instructor at checkout. Defaults off, so nothing an admin already sells
   * changes shape unless they opt in.
   */
  instructorBound?: boolean
  /** Sold as a trial of its session type (be/CONTEXT.md § Trial). Fixed once made. */
  isTrial?: boolean
  priceSgd: string
  /** The Entity it is sold under. Left out, it goes in the studio's first live Entity; the admin routes always send it. */
  entityId?: string
}

export async function createPtPackage(
  tenantId: string,
  input: CreatePtPackageInput,
): Promise<PtPackageRow> {
  const entityId = await entityForNewPackage(tenantId, input.entityId)
  const [row] = await db
    .insert(ptPackages)
    .values({
      tenantId,
      entityId,
      name: input.name,
      sessionType: input.sessionType,
      numSessions: input.numSessions,
      validityDays: input.validityDays,
      instructorBound: input.instructorBound ?? false,
      isTrial: input.isTrial ?? false,
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
export async function createPtPackageWithPromotions(
  tenantId: string,
  input: CreatePtPackageInput,
  promotions: PromotionWriteInput[],
  actorStaffId: string,
): Promise<PtPackageRow> {
  return db.transaction(async () => {
    const row = await createPtPackage(tenantId, input)
    if (promotions.length) {
      await replacePromotionsForParent(tenantId, 'pt_package', row.id, promotions, actorStaffId)
    }
    return row
  })
}

export interface UpdatePtPackageInput {
  name?: string
  priceSgd?: string
  numSessions?: number
  /**
   * Future sales only. The purchased row's `expires_at` is stamped at purchase
   * from the validity in force then, so editing this never relengthens or
   * shortens a package a member already owns.
   */
  validityDays?: number
  /**
   * Future sales only, for the same reason the validity is. The binding a
   * member already bought lives on their own row as an instructor id, and
   * nothing here can reach it.
   */
  instructorBound?: boolean
  status?: 'active' | 'archived'
  /**
   * A move to another Entity, checked only when it is a change. A move cancels
   * nothing: the packages members hold read their Entity through this one.
   */
  entityId?: string
}

export async function updatePtPackage(
  tenantId: string,
  id: string,
  patch: UpdatePtPackageInput,
): Promise<PtPackageRow> {
  const current = await getPtPackage(tenantId, id)
  const moveTo = await entityMoveOf(tenantId, current, patch)
  const changes = {
    ...(moveTo !== undefined ? { entityId: moveTo } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.priceSgd !== undefined ? { priceSgd: patch.priceSgd } : {}),
    ...(patch.numSessions !== undefined ? { numSessions: patch.numSessions } : {}),
    ...(patch.validityDays !== undefined ? { validityDays: patch.validityDays } : {}),
    ...(patch.instructorBound !== undefined ? { instructorBound: patch.instructorBound } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  }
  // Nothing to change (an edit naming the Entity the package is already in):
  // an empty UPDATE is an error, and the package is as it should be.
  if (Object.keys(changes).length === 0) return current
  const [row] = await db
    .update(ptPackages)
    .set(changes)
    .where(and(eq(ptPackages.tenantId, tenantId), eq(ptPackages.id, id)))
    .returning()
  return row!
}

/**
 * An edit and the Promotions sent with it, saved together or not at all, as
 * `createPtPackageWithPromotions` does: one savepoint, so a Promotion the
 * database refuses takes the package's changes with it. No `promotions` leaves
 * the package's Promotions as they are.
 */
export async function updatePtPackageWithPromotions(
  tenantId: string,
  id: string,
  patch: UpdatePtPackageInput,
  promotions: PromotionWriteInput[] | undefined,
  actorStaffId: string,
): Promise<PtPackageRow> {
  return db.transaction(async () => {
    const row = await updatePtPackage(tenantId, id, patch)
    if (promotions !== undefined) {
      await replacePromotionsForParent(tenantId, 'pt_package', id, promotions, actorStaffId)
    }
    return row
  })
}

export async function archivePtPackage(tenantId: string, id: string): Promise<PtPackageRow> {
  const existing = await getPtPackage(tenantId, id)
  if (existing.status === 'archived') {
    throw new BadRequestError('pt_package_already_archived')
  }
  const [row] = await db
    .update(ptPackages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(and(eq(ptPackages.tenantId, tenantId), eq(ptPackages.id, id)))
    .returning()
  return row!
}

export async function unarchivePtPackage(tenantId: string, id: string): Promise<PtPackageRow> {
  const existing = await getPtPackage(tenantId, id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('pt_package_not_archived')
  }
  await assertEntityUsable(tenantId, existing.entityId)
  const [row] = await db
    .update(ptPackages)
    .set({ status: 'active', archivedAt: null })
    .where(and(eq(ptPackages.tenantId, tenantId), eq(ptPackages.id, id)))
    .returning()
  return row!
}

/**
 * Soft-delete a PT package. Must be currently archived; the row stays in DB
 * so historical client_packages references keep resolving.
 */
export async function softDeletePtPackage(tenantId: string, id: string): Promise<void> {
  const existing = await getPtPackage(tenantId, id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('pt_package_not_archived')
  }
  await db
    .update(ptPackages)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(ptPackages.tenantId, tenantId), eq(ptPackages.id, id)))
}
