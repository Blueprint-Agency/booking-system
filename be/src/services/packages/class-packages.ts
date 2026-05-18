import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { classPackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export type ClassPackageRow = typeof classPackages.$inferSelect
export type ClassPackageKind = 'credit_bundle' | 'unlimited' | 'trial'

export async function listClassPackages(opts: {
  status?: 'active' | 'archived'
  kind?: ClassPackageKind
}): Promise<ClassPackageRow[]> {
  const filters = []
  if (opts.status) filters.push(eq(classPackages.status, opts.status))
  if (opts.kind) filters.push(eq(classPackages.kind, opts.kind))
  if (!filters.length) return db.select().from(classPackages)
  return db
    .select()
    .from(classPackages)
    .where(and(...filters))
}

export async function getClassPackage(id: string): Promise<ClassPackageRow> {
  const [row] = await db.select().from(classPackages).where(eq(classPackages.id, id)).limit(1)
  if (!row) throw new NotFoundError('class_package_not_found')
  return row
}

export interface CreateClassPackageInput {
  name: string
  description?: string | null
  kind: ClassPackageKind
  credits?: number | null
  validityDays?: number | null
  durationDays?: number | null
  priceSgd: string // numeric, formatted "120.00"
}

function validateKindFields(input: CreateClassPackageInput | UpdateClassPackageInput, kind: ClassPackageKind) {
  if (kind === 'credit_bundle') {
    if (input.credits == null || input.validityDays == null) {
      throw new BadRequestError('credit_bundle_requires_credits_and_validity')
    }
    if (input.durationDays != null) {
      throw new BadRequestError('credit_bundle_disallows_duration_days')
    }
  } else if (kind === 'unlimited') {
    if (input.durationDays == null) {
      throw new BadRequestError('unlimited_requires_duration_days')
    }
    if (input.credits != null || input.validityDays != null) {
      throw new BadRequestError('unlimited_disallows_credits_or_validity')
    }
  } else if (kind === 'trial') {
    if (input.credits == null) {
      throw new BadRequestError('trial_requires_credits')
    }
    if (input.durationDays != null) {
      throw new BadRequestError('trial_disallows_duration_days')
    }
  }
}

export async function createClassPackage(input: CreateClassPackageInput): Promise<ClassPackageRow> {
  validateKindFields(input, input.kind)
  const [row] = await db
    .insert(classPackages)
    .values({
      name: input.name,
      description: input.description ?? null,
      kind: input.kind,
      credits: input.credits ?? null,
      validityDays: input.validityDays ?? null,
      durationDays: input.durationDays ?? null,
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
  durationDays?: number | null
  status?: 'active' | 'archived'
}

export async function updateClassPackage(
  id: string,
  patch: UpdateClassPackageInput,
): Promise<ClassPackageRow> {
  const current = await getClassPackage(id)
  const merged: CreateClassPackageInput = {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    kind: current.kind,
    credits: patch.credits !== undefined ? patch.credits : current.credits,
    validityDays: patch.validityDays !== undefined ? patch.validityDays : current.validityDays,
    durationDays: patch.durationDays !== undefined ? patch.durationDays : current.durationDays,
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
      ...(patch.durationDays !== undefined ? { durationDays: patch.durationDays } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .where(eq(classPackages.id, id))
    .returning()
  return row!
}

export async function archiveClassPackage(id: string): Promise<ClassPackageRow> {
  await getClassPackage(id)
  const [row] = await db
    .update(classPackages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(eq(classPackages.id, id))
    .returning()
  return row!
}
