import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { ptPackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export type PtPackageRow = typeof ptPackages.$inferSelect
export type PtSessionType = '1on1' | '2on1'

export async function listPtPackages(opts: {
  status?: 'active' | 'archived'
  sessionType?: PtSessionType
}): Promise<PtPackageRow[]> {
  const filters = [isNull(ptPackages.deletedAt)]
  if (opts.status) filters.push(eq(ptPackages.status, opts.status))
  if (opts.sessionType) filters.push(eq(ptPackages.sessionType, opts.sessionType))
  return db
    .select()
    .from(ptPackages)
    .where(filters.length === 1 ? filters[0] : and(...filters))
}

export async function getPtPackage(id: string): Promise<PtPackageRow> {
  const [row] = await db
    .select()
    .from(ptPackages)
    .where(and(eq(ptPackages.id, id), isNull(ptPackages.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('pt_package_not_found')
  return row
}

export interface CreatePtPackageInput {
  name: string
  sessionType: PtSessionType
  numSessions: number
  priceSgd: string
}

export async function createPtPackage(input: CreatePtPackageInput): Promise<PtPackageRow> {
  const [row] = await db
    .insert(ptPackages)
    .values({
      name: input.name,
      sessionType: input.sessionType,
      numSessions: input.numSessions,
      priceSgd: input.priceSgd,
      status: 'active',
    })
    .returning()
  return row!
}

export interface UpdatePtPackageInput {
  name?: string
  priceSgd?: string
  numSessions?: number
  status?: 'active' | 'archived'
}

export async function updatePtPackage(id: string, patch: UpdatePtPackageInput): Promise<PtPackageRow> {
  await getPtPackage(id)
  const [row] = await db
    .update(ptPackages)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.priceSgd !== undefined ? { priceSgd: patch.priceSgd } : {}),
      ...(patch.numSessions !== undefined ? { numSessions: patch.numSessions } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .where(eq(ptPackages.id, id))
    .returning()
  return row!
}

export async function archivePtPackage(id: string): Promise<PtPackageRow> {
  const existing = await getPtPackage(id)
  if (existing.status === 'archived') {
    throw new BadRequestError('pt_package_already_archived')
  }
  const [row] = await db
    .update(ptPackages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(eq(ptPackages.id, id))
    .returning()
  return row!
}

export async function unarchivePtPackage(id: string): Promise<PtPackageRow> {
  const existing = await getPtPackage(id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('pt_package_not_archived')
  }
  const [row] = await db
    .update(ptPackages)
    .set({ status: 'active', archivedAt: null })
    .where(eq(ptPackages.id, id))
    .returning()
  return row!
}

/**
 * Soft-delete a PT package. Must be currently archived; the row stays in DB
 * so historical client_packages references keep resolving.
 */
export async function softDeletePtPackage(id: string): Promise<void> {
  const existing = await getPtPackage(id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('pt_package_not_archived')
  }
  await db
    .update(ptPackages)
    .set({ deletedAt: sql`now()` })
    .where(eq(ptPackages.id, id))
}
