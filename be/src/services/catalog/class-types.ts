import { and, count, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classTypes } from '../../db/schema/catalog'
import { bookings } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import type { ClassDifficulty } from '../../db/enums'
import { now } from '../../lib/clock'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { assertEntityUsable, defaultEntityId } from './entities'

export type ClassTypeRow = typeof classTypes.$inferSelect

export async function listClassTypes(
  tenantId: string,
  opts: { includeArchived: boolean },
): Promise<ClassTypeRow[]> {
  if (opts.includeArchived) {
    return db
      .select()
      .from(classTypes)
      .where(and(eq(classTypes.tenantId, tenantId), isNull(classTypes.deletedAt)))
  }
  return db
    .select()
    .from(classTypes)
    .where(
      and(
        eq(classTypes.tenantId, tenantId),
        isNull(classTypes.archivedAt),
        isNull(classTypes.deletedAt),
      ),
    )
}

export async function getClassType(tenantId: string, id: string): Promise<ClassTypeRow> {
  const [row] = await db
    .select()
    .from(classTypes)
    .where(
      and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, id), isNull(classTypes.deletedAt)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('class_type_not_found')
  return row
}

/**
 * The id names one of this studio's class types, or `class_type_not_found`: an
 * id nobody has, another studio's and a deleted one are refused alike, before
 * anything is written, so a schedule never reaches the foreign key. An archived
 * type is still schedulable.
 */
export async function assertClassTypeInStudio(tenantId: string, id: string): Promise<void> {
  const [row] = await db
    .select({ id: classTypes.id })
    .from(classTypes)
    .where(
      and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, id), isNull(classTypes.deletedAt)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('class_type_not_found')
}

// Validates depth-1 hierarchy: parent_id must point to a row whose own parent_id IS NULL.
// Going through `getClassType` also means a parent belonging to another tenant
// is refused as `class_type_not_found`.
async function assertValidParent(
  tenantId: string,
  parentId: string | null | undefined,
): Promise<ClassTypeRow | null> {
  if (!parentId) return null
  const parent = await getClassType(tenantId, parentId) // 404 if missing
  if (parent.parentId !== null) {
    throw new BadRequestError('parent_must_be_root', { parent_id: parentId })
  }
  return parent
}

/**
 * A sub-type has no Entity of its own: it shares its parent's, so an Entity
 * named on a write that makes or keeps a sub-type is refused, even one equal to
 * the parent's. Saying it is refused rather than ignored keeps a screen that
 * offers the choice for a sub-type from believing it was saved.
 */
function assertNoOwnEntity(entityId: string | undefined): void {
  if (entityId !== undefined) throw new BadRequestError('class_type_entity_inherited')
}

// Reject if this row currently has children — we can't turn a parent into a child.
async function assertNoChildren(tenantId: string, id: string): Promise<void> {
  const children = await db
    .select({ id: classTypes.id })
    .from(classTypes)
    .where(
      and(
        eq(classTypes.tenantId, tenantId),
        eq(classTypes.parentId, id),
        isNull(classTypes.deletedAt),
      ),
    )
  if (children.length) {
    throw new ConflictError('class_type_has_children', { child_ids: children.map(r => r.id) })
  }
}

export async function createClassType(
  tenantId: string,
  input: {
    name: string
    description?: string | null
    difficulty?: ClassDifficulty
    parent_id?: string | null
    entity_id?: string
  },
): Promise<ClassTypeRow> {
  const parent = await assertValidParent(tenantId, input.parent_id)
  // A sub-type takes its parent's Entity; a top-level type the one named, or
  // the studio's first when none is (a studio with one Entity never has to think
  // about it, and no route writes a type with no Entity).
  let entityId: string | null
  if (parent) {
    assertNoOwnEntity(input.entity_id)
    entityId = parent.entityId
  } else if (input.entity_id !== undefined) {
    await assertEntityUsable(tenantId, input.entity_id)
    entityId = input.entity_id
  } else {
    entityId = await defaultEntityId(tenantId)
  }
  const [row] = await db
    .insert(classTypes)
    .values({
      tenantId,
      name: input.name,
      description: input.description ?? null,
      difficulty: input.difficulty ?? 'general',
      parentId: input.parent_id ?? null,
      entityId,
    })
    .returning()
  return row!
}

export async function updateClassType(
  tenantId: string,
  id: string,
  patch: {
    name?: string
    description?: string | null
    difficulty?: ClassDifficulty
    parent_id?: string | null
    entity_id?: string
  },
): Promise<ClassTypeRow> {
  const existing = await getClassType(tenantId, id) // 404 if missing
  // The type's parent once this write is applied: the one named, or the one it has.
  const parentId: string | null = patch.parent_id !== undefined ? patch.parent_id : existing.parentId
  let parent: ClassTypeRow | null = null
  if (patch.parent_id !== undefined) {
    if (patch.parent_id === id) throw new BadRequestError('parent_self_reference')
    parent = await assertValidParent(tenantId, patch.parent_id)
    if (patch.parent_id !== null) {
      // We're turning this row into a child — make sure it isn't currently a parent.
      await assertNoChildren(tenantId, id)
    }
  }

  const setPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) setPatch.name = patch.name
  if (patch.description !== undefined) setPatch.description = patch.description
  if (patch.difficulty !== undefined) setPatch.difficulty = patch.difficulty
  if (patch.parent_id !== undefined) setPatch.parentId = patch.parent_id

  // The Entity. A row that is or becomes a sub-type has none of its own: it is
  // its parent's, which a reparent re-reads. A row that is or becomes top-level
  // keeps the one it stores and accepts a new one; moving a parent rewrites its
  // sub-types, archived and deleted ones included (they stay in the tree).
  let rewriteChildren = false
  if (parentId !== null) {
    assertNoOwnEntity(patch.entity_id)
    if (parent) setPatch.entityId = parent.entityId
  } else if (patch.entity_id !== undefined) {
    await assertEntityUsable(tenantId, patch.entity_id)
    if (patch.entity_id !== existing.entityId) {
      setPatch.entityId = patch.entity_id
      rewriteChildren = true
    }
  }

  if (Object.keys(setPatch).length === 0) return existing
  // One savepoint: a failure never leaves a sub-type on the wrong Entity.
  return db.transaction(async tx => {
    const [row] = await tx
      .update(classTypes)
      .set(setPatch)
      .where(and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, id)))
      .returning()
    if (rewriteChildren) {
      await tx
        .update(classTypes)
        .set({ entityId: patch.entity_id })
        .where(and(eq(classTypes.tenantId, tenantId), eq(classTypes.parentId, id)))
    }
    return row!
  })
}

/**
 * What changing a top-level Class Type's Entity reaches, before the admin saves:
 * the upcoming classes of the type and of its sub-types, and the confirmed
 * bookings on them. "Upcoming" is the rule archiving uses (an active class that
 * has not ended), read against the app clock. A move cancels nothing and touches
 * neither table: a class reads its Entity through its Class Type, so these are
 * the classes whose eligible packages change, not rows that change.
 */
export async function previewEntityMove(
  tenantId: string,
  id: string,
  entityId: string,
): Promise<{ upcoming_classes: number; bookings: number }> {
  const type = await getClassType(tenantId, id)
  if (type.parentId !== null) throw new BadRequestError('class_type_entity_inherited')
  await assertEntityUsable(tenantId, entityId)
  // Nothing moves when the Entity is the one it has.
  if (entityId === type.entityId) return { upcoming_classes: 0, bookings: 0 }

  const family = db
    .select({ id: classTypes.id })
    .from(classTypes)
    .where(and(eq(classTypes.tenantId, tenantId), or(eq(classTypes.id, id), eq(classTypes.parentId, id))))
  const upcoming = and(
    eq(classes.tenantId, tenantId),
    inArray(classes.classTypeId, family),
    eq(classes.lifecycle, 'active'),
    gt(classes.endsAt, now()),
  )
  const [classCount] = await db.select({ n: count() }).from(classes).where(upcoming)
  const [bookingCount] = await db
    .select({ n: count() })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(and(upcoming, eq(bookings.tenantId, tenantId), eq(bookings.kind, 'class'), eq(bookings.state, 'confirmed')))
  return { upcoming_classes: Number(classCount?.n ?? 0), bookings: Number(bookingCount?.n ?? 0) }
}

// Returns the list of ids whose "linked data" we must check before allowing archive.
// For a parent class type that's a result of (id, child_ids), all rows are checked.
async function gatherLinkedDataBlockers(tenantId: string, rootId: string) {
  const children = await db
    .select({ id: classTypes.id })
    .from(classTypes)
    .where(
      and(
        eq(classTypes.tenantId, tenantId),
        eq(classTypes.parentId, rootId),
        isNull(classTypes.deletedAt),
      ),
    )
  const idsToCheck = [rootId, ...children.map(c => c.id)]
  const now = new Date()

  const futureClasses = await db
    .select({ id: classes.id, classTypeId: classes.classTypeId })
    .from(classes)
    .where(
      and(
        eq(classes.tenantId, tenantId),
        inArray(classes.classTypeId, idsToCheck),
        eq(classes.lifecycle, 'active'),
        gt(classes.endsAt, now),
      ),
    )

  return { futureClasses, idsChecked: idsToCheck }
}

export async function archiveClassType(tenantId: string, id: string): Promise<ClassTypeRow> {
  const existing = await getClassType(tenantId, id)
  if (existing.deletedAt) throw new NotFoundError('class_type_not_found')
  const { futureClasses, idsChecked } = await gatherLinkedDataBlockers(tenantId, id)
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
    .where(and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, id)))
    .returning()
  return row!
}

export async function unarchiveClassType(tenantId: string, id: string): Promise<ClassTypeRow> {
  const existing = await getClassType(tenantId, id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('class_type_not_archived')
  }
  // Not back into an Entity the studio has retired: a move to a live one comes first.
  await assertEntityUsable(tenantId, existing.entityId)
  const [row] = await db
    .update(classTypes)
    .set({ archivedAt: null })
    .where(and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, id)))
    .returning()
  return row!
}

/**
 * Soft-delete a class type. Must be currently archived and not yet deleted.
 */
export async function softDeleteClassType(tenantId: string, id: string): Promise<void> {
  const existing = await getClassType(tenantId, id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('class_type_not_archived')
  }
  await db
    .update(classTypes)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, id)))
}
