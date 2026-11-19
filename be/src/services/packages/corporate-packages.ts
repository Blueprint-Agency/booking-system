import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { corporatePackages } from '../../db/schema/packages'
import { BadRequestError } from '../../shared/errors'
import {
  assertEntityAllowsPackage,
  assertEntityUsable,
  entityForNewPackage,
} from '../catalog/entities'

export type CorporatePackageRow = typeof corporatePackages.$inferSelect

export async function listCorporatePackages(
  tenantId: string,
  opts: {
    status?: 'active' | 'archived'
    entityId?: string
  } = {},
): Promise<CorporatePackageRow[]> {
  const filters = [eq(corporatePackages.tenantId, tenantId), isNull(corporatePackages.deletedAt)]
  if (opts.status) filters.push(eq(corporatePackages.status, opts.status))
  if (opts.entityId) filters.push(eq(corporatePackages.entityId, opts.entityId))
  return db
    .select()
    .from(corporatePackages)
    .where(and(...filters))
    .orderBy(desc(corporatePackages.createdAt))
}

export async function getCorporatePackage(
  tenantId: string,
  id: string,
): Promise<CorporatePackageRow | null> {
  const [row] = await db
    .select()
    .from(corporatePackages)
    .where(
      and(
        eq(corporatePackages.tenantId, tenantId),
        eq(corporatePackages.id, id),
        isNull(corporatePackages.deletedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

interface CreateCorporatePackageInput {
  name: string
  description?: string | null
  priceSgd: string
  createdByStaffId: string
  /** The Entity it is sold under. Left out, it goes in the studio's first live Entity; the admin route always sends it. */
  entityId?: string
}

export async function createCorporatePackage(
  tenantId: string,
  input: CreateCorporatePackageInput,
): Promise<CorporatePackageRow> {
  const entityId = await entityForNewPackage(tenantId, input.entityId)
  const [row] = await db
    .insert(corporatePackages)
    .values({
      tenantId,
      entityId,
      name: input.name,
      description: input.description ?? null,
      priceSgd: input.priceSgd,
      status: 'active',
      createdByStaffId: input.createdByStaffId,
    })
    .returning()
  return row!
}

interface UpdateCorporatePackageInput {
  name?: string
  description?: string | null
  priceSgd?: string
  /** A move to another Entity, checked only when it is a change. */
  entityId?: string
}

export async function updateCorporatePackage(
  tenantId: string,
  id: string,
  patch: UpdateCorporatePackageInput,
): Promise<CorporatePackageRow | null> {
  const existing = await getCorporatePackage(tenantId, id)
  if (!existing) return null

  const setValues: Record<string, unknown> = {}
  if (patch.entityId !== undefined && patch.entityId !== existing.entityId) {
    await assertEntityUsable(tenantId, patch.entityId)
    setValues.entityId = patch.entityId
  }
  if (patch.name !== undefined) setValues.name = patch.name
  if (patch.description !== undefined) setValues.description = patch.description
  if (patch.priceSgd !== undefined) setValues.priceSgd = patch.priceSgd

  if (Object.keys(setValues).length === 0) return existing

  const [row] = await db
    .update(corporatePackages)
    .set(setValues)
    .where(and(eq(corporatePackages.tenantId, tenantId), eq(corporatePackages.id, id)))
    .returning()
  return row ?? null
}

export async function archiveCorporatePackage(
  tenantId: string,
  id: string,
): Promise<CorporatePackageRow | null> {
  const existing = await getCorporatePackage(tenantId, id)
  if (!existing) return null
  if (existing.status === 'archived') {
    throw new BadRequestError('corporate_package_already_archived')
  }
  const [row] = await db
    .update(corporatePackages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(and(eq(corporatePackages.tenantId, tenantId), eq(corporatePackages.id, id)))
    .returning()
  return row ?? null
}

export async function unarchiveCorporatePackage(
  tenantId: string,
  id: string,
): Promise<CorporatePackageRow | null> {
  const existing = await getCorporatePackage(tenantId, id)
  if (!existing) return null
  if (existing.status !== 'archived') {
    throw new BadRequestError('corporate_package_not_archived')
  }
  await assertEntityAllowsPackage(tenantId, existing.entityId)
  const [row] = await db
    .update(corporatePackages)
    .set({ status: 'active', archivedAt: null })
    .where(and(eq(corporatePackages.tenantId, tenantId), eq(corporatePackages.id, id)))
    .returning()
  return row ?? null
}

/**
 * Soft-delete a corporate package. Row must be currently archived and not
 * yet deleted. Stays in DB so historical corporate_session references resolve.
 */
export async function softDeleteCorporatePackage(tenantId: string, id: string): Promise<void> {
  const existing = await getCorporatePackage(tenantId, id)
  if (!existing) {
    throw new BadRequestError('corporate_package_not_found')
  }
  if (existing.status !== 'archived') {
    throw new BadRequestError('corporate_package_not_archived')
  }
  await db
    .update(corporatePackages)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(corporatePackages.tenantId, tenantId), eq(corporatePackages.id, id)))
}
