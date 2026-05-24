import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { corporatePackages } from '../../db/schema/packages'
import { corporateSessions } from '../../db/schema/schedule'
import { BadRequestError } from '../../shared/errors'

export type CorporatePackageRow = typeof corporatePackages.$inferSelect

export async function listCorporatePackages(opts: {
  status?: 'active' | 'archived'
} = {}): Promise<CorporatePackageRow[]> {
  const filters = [isNull(corporatePackages.deletedAt)]
  if (opts.status) filters.push(eq(corporatePackages.status, opts.status))
  return db
    .select()
    .from(corporatePackages)
    .where(filters.length === 1 ? filters[0] : and(...filters))
    .orderBy(desc(corporatePackages.createdAt))
}

export async function getCorporatePackage(id: string): Promise<CorporatePackageRow | null> {
  const [row] = await db
    .select()
    .from(corporatePackages)
    .where(and(eq(corporatePackages.id, id), isNull(corporatePackages.deletedAt)))
    .limit(1)
  return row ?? null
}

export interface CreateCorporatePackageInput {
  name: string
  description?: string | null
  priceSgd: string
  createdByStaffId: string
}

export async function createCorporatePackage(
  input: CreateCorporatePackageInput,
): Promise<CorporatePackageRow> {
  const [row] = await db
    .insert(corporatePackages)
    .values({
      name: input.name,
      description: input.description ?? null,
      priceSgd: input.priceSgd,
      status: 'active',
      createdByStaffId: input.createdByStaffId,
    })
    .returning()
  return row!
}

export interface UpdateCorporatePackageInput {
  name?: string
  description?: string | null
  priceSgd?: string
}

export async function updateCorporatePackage(
  id: string,
  patch: UpdateCorporatePackageInput,
): Promise<CorporatePackageRow | null> {
  const existing = await getCorporatePackage(id)
  if (!existing) return null

  const setValues: Record<string, unknown> = {}
  if (patch.name !== undefined) setValues.name = patch.name
  if (patch.description !== undefined) setValues.description = patch.description
  if (patch.priceSgd !== undefined) setValues.priceSgd = patch.priceSgd

  if (Object.keys(setValues).length === 0) return existing

  const [row] = await db
    .update(corporatePackages)
    .set(setValues)
    .where(eq(corporatePackages.id, id))
    .returning()
  return row ?? null
}

export async function archiveCorporatePackage(id: string): Promise<CorporatePackageRow | null> {
  const existing = await getCorporatePackage(id)
  if (!existing) return null
  if (existing.status === 'archived') {
    throw new BadRequestError('corporate_package_already_archived')
  }
  const [row] = await db
    .update(corporatePackages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(eq(corporatePackages.id, id))
    .returning()
  return row ?? null
}

export async function unarchiveCorporatePackage(id: string): Promise<CorporatePackageRow | null> {
  const existing = await getCorporatePackage(id)
  if (!existing) return null
  if (existing.status !== 'archived') {
    throw new BadRequestError('corporate_package_not_archived')
  }
  const [row] = await db
    .update(corporatePackages)
    .set({ status: 'active', archivedAt: null })
    .where(eq(corporatePackages.id, id))
    .returning()
  return row ?? null
}

/**
 * Legacy hard-delete. Kept only because the PATCH-driven UI predates the
 * uniform soft-delete contract. New callers should use softDeleteCorporatePackage.
 */
export async function deleteCorporatePackage(id: string): Promise<'ok' | 'in_use'> {
  const [used] = await db
    .select({ id: corporateSessions.id })
    .from(corporateSessions)
    .where(eq(corporateSessions.corporatePackageId, id))
    .limit(1)
  if (used) return 'in_use'
  await db.delete(corporatePackages).where(eq(corporatePackages.id, id))
  return 'ok'
}

/**
 * Soft-delete a corporate package. Row must be currently archived and not
 * yet deleted. Stays in DB so historical corporate_session references resolve.
 */
export async function softDeleteCorporatePackage(id: string): Promise<void> {
  const existing = await getCorporatePackage(id)
  if (!existing) {
    throw new BadRequestError('corporate_package_not_found')
  }
  if (existing.status !== 'archived') {
    throw new BadRequestError('corporate_package_not_archived')
  }
  await db
    .update(corporatePackages)
    .set({ deletedAt: sql`now()` })
    .where(eq(corporatePackages.id, id))
}
