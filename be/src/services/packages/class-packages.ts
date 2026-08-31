import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classPackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export type ClassPackageRow = typeof classPackages.$inferSelect
export type ClassPackageKind = 'credit_bundle' | 'unlimited' | 'trial'

export async function listClassPackages(
  tenantId: string,
  opts: {
    status?: 'active' | 'archived'
    kind?: ClassPackageKind
  },
): Promise<ClassPackageRow[]> {
  const filters = [eq(classPackages.tenantId, tenantId), isNull(classPackages.deletedAt)]
  if (opts.status) filters.push(eq(classPackages.status, opts.status))
  if (opts.kind) filters.push(eq(classPackages.kind, opts.kind))
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
  credits?: number | null
  validityDays?: number | null
  durationMonths?: number | null
  priceSgd: string // numeric, formatted "120.00"
}

function validateKindFields(input: CreateClassPackageInput | UpdateClassPackageInput, kind: ClassPackageKind) {
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
  } else if (kind === 'trial') {
    // Validity is REQUIRED for a trial (spec §3). "Never expires" has left the
    // domain: a null expiry now means Dormant, which only an Unlimited Plan can be.
    if (input.credits == null || input.validityDays == null) {
      throw new BadRequestError('trial_requires_credits_and_validity')
    }
    if (input.durationMonths != null) {
      throw new BadRequestError('trial_disallows_duration_months')
    }
  }
}

export async function createClassPackage(
  tenantId: string,
  input: CreateClassPackageInput,
): Promise<ClassPackageRow> {
  validateKindFields(input, input.kind)
  const [row] = await db
    .insert(classPackages)
    .values({
      tenantId,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind,
      credits: input.credits ?? null,
      validityDays: input.validityDays ?? null,
      durationMonths: input.durationMonths ?? null,
      priceSgd: input.priceSgd,
      status: 'active',
    })
    .returning()
  return row!
}

export interface UpdateClassPackageInput {
  name?: string
  description?: string | null
  priceSgd?: string
  credits?: number | null
  validityDays?: number | null
  durationMonths?: number | null
  status?: 'active' | 'archived'
}

export async function updateClassPackage(
  tenantId: string,
  id: string,
  patch: UpdateClassPackageInput,
): Promise<ClassPackageRow> {
  const current = await getClassPackage(tenantId, id)
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

  const [row] = await db
    .update(classPackages)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priceSgd !== undefined ? { priceSgd: patch.priceSgd } : {}),
      ...(patch.credits !== undefined ? { credits: patch.credits } : {}),
      ...(patch.validityDays !== undefined ? { validityDays: patch.validityDays } : {}),
      ...(patch.durationMonths !== undefined ? { durationMonths: patch.durationMonths } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .where(and(eq(classPackages.tenantId, tenantId), eq(classPackages.id, id)))
    .returning()
  return row!
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
