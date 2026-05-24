import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classTypes } from '../../db/schema/catalog'
import { classes } from '../../db/schema/schedule'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export type ClassTypeRow = typeof classTypes.$inferSelect

export async function listClassTypes(opts: { includeArchived: boolean }): Promise<ClassTypeRow[]> {
  if (opts.includeArchived) {
    return db.select().from(classTypes).where(isNull(classTypes.deletedAt))
  }
  return db
    .select()
    .from(classTypes)
    .where(and(isNull(classTypes.archivedAt), isNull(classTypes.deletedAt)))
}

export async function getClassType(id: string): Promise<ClassTypeRow> {
  const [row] = await db
    .select()
    .from(classTypes)
    .where(and(eq(classTypes.id, id), isNull(classTypes.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('class_type_not_found')
  return row
}

// Validates depth-1 hierarchy: parent_id must point to a row whose own parent_id IS NULL.
async function assertValidParent(parentId: string | null | undefined): Promise<void> {
  if (!parentId) return
  const parent = await getClassType(parentId) // 404 if missing
  if (parent.parentId !== null) {
    throw new BadRequestError('parent_must_be_root', { parent_id: parentId })
  }
}

// Reject if this row currently has children — we can't turn a parent into a child.
async function assertNoChildren(id: string): Promise<void> {
  const children = await db
    .select({ id: classTypes.id })
    .from(classTypes)
    .where(and(eq(classTypes.parentId, id), isNull(classTypes.deletedAt)))
  if (children.length) {
    throw new ConflictError('class_type_has_children', { child_ids: children.map(r => r.id) })
  }
}

export async function createClassType(input: {
  name: string
  description?: string | null
  parent_id?: string | null
}): Promise<ClassTypeRow> {
  await assertValidParent(input.parent_id)
  const [row] = await db
    .insert(classTypes)
    .values({
      name: input.name,
      description: input.description ?? null,
      parentId: input.parent_id ?? null,
    })
    .returning()
  return row!
}

export async function updateClassType(
  id: string,
  patch: { name?: string; description?: string | null; parent_id?: string | null },
): Promise<ClassTypeRow> {
  await getClassType(id) // 404 if missing
  if (patch.parent_id !== undefined) {
    if (patch.parent_id === id) throw new BadRequestError('parent_self_reference')
    await assertValidParent(patch.parent_id)
    if (patch.parent_id !== null) {
      // We're turning this row into a child — make sure it isn't currently a parent.
      await assertNoChildren(id)
    }
  }
  const setPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) setPatch.name = patch.name
  if (patch.description !== undefined) setPatch.description = patch.description
  if (patch.parent_id !== undefined) setPatch.parentId = patch.parent_id
  const [row] = await db.update(classTypes).set(setPatch).where(eq(classTypes.id, id)).returning()
  return row!
}

// Returns the list of ids whose "linked data" we must check before allowing archive.
// For a parent class type that's a result of (id, child_ids), all rows are checked.
async function gatherLinkedDataBlockers(rootId: string) {
  const children = await db
    .select({ id: classTypes.id })
    .from(classTypes)
    .where(and(eq(classTypes.parentId, rootId), isNull(classTypes.deletedAt)))
  const idsToCheck = [rootId, ...children.map(c => c.id)]
  const now = new Date()

  const futureClasses = await db
    .select({ id: classes.id, classTypeId: classes.classTypeId })
    .from(classes)
    .where(
      and(
        inArray(classes.classTypeId, idsToCheck),
        eq(classes.lifecycle, 'active'),
        gt(classes.endsAt, now),
      ),
    )

  return { futureClasses, idsChecked: idsToCheck }
}

export async function archiveClassType(id: string): Promise<ClassTypeRow> {
  const existing = await getClassType(id)
  if (existing.deletedAt) throw new NotFoundError('class_type_not_found')
  const { futureClasses, idsChecked } = await gatherLinkedDataBlockers(id)
  if (futureClasses.length) {
    throw new ConflictError('class_type_in_use', {
      // Per spec §3: "Parents are also blocked while any child still has linked data."
      checked_class_type_ids: idsChecked,
      class_ids: futureClasses.map(r => r.id),
    })
  }
  const [row] = await db
    .update(classTypes)
    .set({ archivedAt: new Date() })
    .where(eq(classTypes.id, id))
    .returning()
  return row!
}

export async function unarchiveClassType(id: string): Promise<ClassTypeRow> {
  const existing = await getClassType(id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('class_type_not_archived')
  }
  const [row] = await db
    .update(classTypes)
    .set({ archivedAt: null })
    .where(eq(classTypes.id, id))
    .returning()
  return row!
}

/**
 * Soft-delete a class type. Must be currently archived and not yet deleted.
 */
export async function softDeleteClassType(id: string): Promise<void> {
  const existing = await getClassType(id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('class_type_not_archived')
  }
  await db
    .update(classTypes)
    .set({ deletedAt: sql`now()` })
    .where(eq(classTypes.id, id))
}
