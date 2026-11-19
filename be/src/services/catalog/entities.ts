import { and, asc, count, eq, inArray, isNull, max, ne, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { classTypes, entities } from '../../db/schema/catalog'
import { classPackages, corporatePackages, ptPackages } from '../../db/schema/packages'
import { isUniqueViolation } from '../../db/unique-violation'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { assertEntityUnused, type EntityUsage } from './entities-usage'
import { ENTITY_SLUG_MAX, slugForEntityName } from './entity-rules'

/**
 * Entities (be/CONTEXT.md § Entity): what a studio files its Class Types and
 * packages under. This is the studio-owned list an admin manages from settings.
 * Class Types and catalogue packages carry an `entity_id`; both count toward an
 * Entity's "still in use".
 */

export type EntityRow = typeof entities.$inferSelect

export type EntityWithUsage = EntityRow & { inUse: EntityUsage }

/**
 * The Entity of a package a member holds: its catalogue source's, class package
 * else PT package (a plan is bought from one of the two, never both). For a
 * query that left-joins `classPackages` and `ptPackages` to `clientPackages`;
 * null for a plan with no source, or a source with no Entity.
 */
export const heldPackageEntityId = sql<string | null>`coalesce(${classPackages.entityId}, ${ptPackages.entityId})`

/**
 * `heldPackageEntityId` for raw SQL: the same read as a correlated subquery for
 * the `client_packages` row aliased `cp` (the alias is the name written in the
 * query, never user input). Scoped to the row's own studio on both reads.
 */
export const heldPackageEntityIdSql = (cp: string) => {
  const alias = sql.raw(cp)
  return sql`coalesce(
    (select src.entity_id from ${classPackages} src
      where src.id = ${alias}.source_class_package_id and src.tenant_id = ${alias}.tenant_id),
    (select src.entity_id from ${ptPackages} src
      where src.id = ${alias}.source_pt_package_id and src.tenant_id = ${alias}.tenant_id)
  )`
}

type CataloguePackageTable = typeof classPackages | typeof ptPackages | typeof corporatePackages

/**
 * A catalogue package is on sale: active and not removed. An archived or
 * removed one has left the catalogue, so it holds no Entity open (an archived
 * one cannot be put back while its Entity is archived: `entityMoveOf`) and does
 * not make its Entity count as having something to buy.
 */
export function packageOnSale(table: CataloguePackageTable, tenantId: string): SQL {
  return and(eq(table.tenantId, tenantId), eq(table.status, 'active'), isNull(table.deletedAt))!
}

/**
 * What still belongs to an Entity. Class Types count when they are live (not
 * archived, not deleted), sub-types too: they hold the Entity of their parent.
 * A package counts while it is on sale (`packageOnSale`).
 */
async function usageOf(tenantId: string, entityId: string): Promise<EntityUsage> {
  const [[typeRow], [classRow], [ptRow], [corporateRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(classTypes)
      .where(
        and(
          eq(classTypes.tenantId, tenantId),
          eq(classTypes.entityId, entityId),
          isNull(classTypes.archivedAt),
          isNull(classTypes.deletedAt),
        ),
      ),
    db
      .select({ n: count() })
      .from(classPackages)
      .where(and(packageOnSale(classPackages, tenantId), eq(classPackages.entityId, entityId))),
    db
      .select({ n: count() })
      .from(ptPackages)
      .where(and(packageOnSale(ptPackages, tenantId), eq(ptPackages.entityId, entityId))),
    db
      .select({ n: count() })
      .from(corporatePackages)
      .where(and(packageOnSale(corporatePackages, tenantId), eq(corporatePackages.entityId, entityId))),
  ])
  return {
    class_types: Number(typeRow?.n ?? 0),
    class_packages: classRow?.n ?? 0,
    pt_packages: ptRow?.n ?? 0,
    corporate_packages: corporateRow?.n ?? 0,
  }
}

export type EntityRef = { id: string; name: string; slug: string }

/**
 * A live Entity, whose slug is `slug` in any casing: the condition every read
 * that takes an `?entity=<slug>` applies to `entities`. An archived Entity's
 * slug is handed back when it is archived, so a live one may reuse it and an
 * archived one never answers to it.
 */
export const liveEntityWithSlug = (slug: string): SQL =>
  and(isNull(entities.archivedAt), sql`lower(${entities.slug}) = lower(${slug})`)!

/**
 * The live Entity of this studio a slug names, or null when it names none: an
 * unknown slug, an archived Entity's or another studio's.
 */
export async function liveEntityIdBySlug(tenantId: string, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), liveEntityWithSlug(slug)))
    .limit(1)
  return row?.id ?? null
}

/**
 * The filter a read applies for its `?entity=<slug>`: `{}` when none is given
 * (every Entity's rows), `{ entityId }` for a live Entity of the studio, and
 * null when the slug names no such Entity (unknown, archived, or another
 * studio's), which every read answers with an empty list. The "land on the first
 * Entity" fallback is the member app's rule, not the API's.
 */
export async function entityScopeForSlug(
  tenantId: string,
  slug: string | undefined,
): Promise<{ entityId?: string } | null> {
  if (!slug) return {}
  const entityId = await liveEntityIdBySlug(tenantId, slug)
  return entityId ? { entityId } : null
}

/**
 * How a row that belongs to an Entity says so: its id, and the Entity's name
 * and slug so a screen can draw it without a second read. Both null on a row
 * with no Entity (one made before Entities and not yet backfilled).
 */
export type EntityFields = { entity_id: string | null; entity: EntityRef | null }

/** The Entity fields for each of `rows`, read in one query, in the order given. */
export async function entityFieldsFor(
  tenantId: string,
  rows: ReadonlyArray<{ entityId: string | null }>,
): Promise<EntityFields[]> {
  const refs = await entityRefsFor(tenantId, rows.map(r => r.entityId))
  return rows.map(r => ({ entity_id: r.entityId, entity: r.entityId ? (refs.get(r.entityId) ?? null) : null }))
}

/**
 * The Entity a catalogue row names, to say who it belongs to: name and slug
 * for the screens that draw it. Archived Entities are included, because a
 * package left in one is still read.
 */
export async function entityRefsFor(
  tenantId: string,
  ids: ReadonlyArray<string | null>,
): Promise<Map<string, EntityRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  if (wanted.length === 0) return new Map()
  const rows = await db
    .select({ id: entities.id, name: entities.name, slug: entities.slug })
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), inArray(entities.id, wanted)))
  return new Map(rows.map(row => [row.id, row]))
}

/**
 * The Entity a new Class Type or package gets when its caller names none: the
 * studio's first live one by display order. Null only for a studio with no
 * Entity at all (a fixture, or one an archive is about to be restored into),
 * which the caller stores as "no Entity" rather than refusing. The admin create
 * routes for Class Types and packages lean on it when no Entity is named.
 */
export async function defaultEntityId(tenantId: string): Promise<string | null> {
  const [first] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), isNull(entities.archivedAt)))
    .orderBy(asc(entities.position), asc(entities.createdAt), asc(entities.id))
    .limit(1)
  return first?.id ?? null
}

/**
 * The id names a live Entity of this studio, or it is refused before anything is
 * written: `entity_not_found` for an id nobody has and for another studio's alike
 * (a foreign key check skips Row-Level Security, so without this read a body
 * naming another studio's Entity would be stored), `entity_archived` for one the
 * studio has retired.
 */
export async function assertEntityUsable(tenantId: string, id: string | null): Promise<void> {
  // A row with no Entity (made before Entities) has none to refuse.
  if (id === null) return
  const [row] = await db
    .select({ archivedAt: entities.archivedAt })
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id)))
    .limit(1)
  if (!row) throw new NotFoundError('entity_not_found')
  if (row.archivedAt) throw new ConflictError('entity_archived', { entity_id: id })
}

/**
 * The Entity to write on a package: the one named, checked to be this studio's
 * and live; or the default when none is named.
 */
export async function entityForNewPackage(tenantId: string, named: string | undefined): Promise<string | null> {
  if (named === undefined) return defaultEntityId(tenantId)
  await assertEntityUsable(tenantId, named)
  return named
}

/**
 * The Entity a package edit moves it to, checked, or undefined when the edit is
 * not a move. A move is checked only when it is a change: a package in an Entity
 * since archived can still be edited, and naming the Entity it is already in
 * changes nothing. With no move, putting an archived package back on sale (a
 * `status: 'active'` edit, the same as unarchiving) is refused while it sits in
 * an archived Entity: the Entity's archive only looked at packages on sale, so
 * an admin moves it to a live Entity first. A move cancels nothing: the
 * packages members hold read their Entity through the catalogue package.
 */
export async function entityMoveOf(
  tenantId: string,
  current: { entityId: string | null; status: string },
  patch: { entityId?: string; status?: string },
): Promise<string | undefined> {
  const moveTo = patch.entityId !== undefined && patch.entityId !== current.entityId ? patch.entityId : undefined
  if (moveTo !== undefined) await assertEntityUsable(tenantId, moveTo)
  else if (patch.status === 'active' && current.status === 'archived') await assertEntityUsable(tenantId, current.entityId)
  return moveTo
}

async function withUsage(tenantId: string, row: EntityRow): Promise<EntityWithUsage> {
  return { ...row, inUse: await usageOf(tenantId, row.id) }
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** A typed slug, folded to lower case; refused unless it is URL-safe words joined by single hyphens. */
function cleanSlug(raw: string): string {
  const slug = raw.trim().toLowerCase()
  if (!slug || slug.length > ENTITY_SLUG_MAX || !SLUG_PATTERN.test(slug)) {
    throw new BadRequestError('entity_slug_invalid', { slug: raw })
  }
  return slug
}

/**
 * Refuse a name or slug that another live Entity of this studio already has,
 * in any casing. The name is looked at first, so a name that clashes in both
 * says so. The unique indexes behind this are the backstop for a race, mapped
 * to the same answers by `translateClash`.
 */
async function assertFree(
  tenantId: string,
  want: { name?: string; slug?: string },
  selfId?: string,
): Promise<void> {
  const others = (extra: SQL) =>
    db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.tenantId, tenantId),
          isNull(entities.archivedAt),
          selfId ? ne(entities.id, selfId) : undefined,
          extra,
        ),
      )
      .limit(1)
  if (want.name !== undefined) {
    const [clash] = await others(sql`lower(${entities.name}) = lower(${want.name})`)
    if (clash) throw new ConflictError('entity_name_taken', { name: want.name })
  }
  if (want.slug !== undefined) {
    const [clash] = await others(sql`lower(${entities.slug}) = lower(${want.slug})`)
    if (clash) throw new ConflictError('entity_slug_taken', { slug: want.slug })
  }
}

function translateClash(err: unknown, want: { name?: string; slug?: string }): never {
  if (isUniqueViolation(err, 'entities_name_live_unique')) {
    throw new ConflictError('entity_name_taken', { name: want.name })
  }
  if (isUniqueViolation(err, 'entities_slug_live_unique')) {
    throw new ConflictError('entity_slug_taken', { slug: want.slug })
  }
  throw err
}

export async function getEntity(tenantId: string, id: string): Promise<EntityWithUsage> {
  const [row] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id)))
    .limit(1)
  if (!row) throw new NotFoundError('entity_not_found')
  return withUsage(tenantId, row)
}

/**
 * A new Entity goes last. Its slug is the one typed, or made from its name; a
 * name with nothing a slug can be made of (no Latin letters or digits) needs
 * one typed.
 */
export async function createEntity(
  tenantId: string,
  input: { name: string; slug?: string },
): Promise<EntityWithUsage> {
  const name = input.name.trim()
  const slug = input.slug !== undefined ? cleanSlug(input.slug) : cleanSlug(slugForEntityName(name))
  await assertFree(tenantId, { name, slug })
  const [last] = await db
    .select({ position: max(entities.position) })
    .from(entities)
    .where(eq(entities.tenantId, tenantId))
  try {
    const [row] = await db
      .insert(entities)
      .values({ tenantId, name, slug, position: (last?.position ?? -1) + 1 })
      .returning()
    return withUsage(tenantId, row!)
  } catch (err) {
    return translateClash(err, { name, slug })
  }
}

/** Rename an Entity, edit its slug, or both. A rename leaves the slug where it is. */
export async function updateEntity(
  tenantId: string,
  id: string,
  patch: { name?: string; slug?: string },
): Promise<EntityWithUsage> {
  await getEntity(tenantId, id) // 404 if missing
  const name = patch.name?.trim()
  const slug = patch.slug !== undefined ? cleanSlug(patch.slug) : undefined
  await assertFree(tenantId, { name, slug }, id)
  try {
    await db
      .update(entities)
      .set({ ...(name !== undefined ? { name } : {}), ...(slug !== undefined ? { slug } : {}), updatedAt: sql`now()` })
      .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id)))
  } catch (err) {
    return translateClash(err, { name, slug })
  }
  return getEntity(tenantId, id)
}

/** The studio's live Entities, locked for the rest of the transaction so two admins cannot both archive "the other one". */
async function lockLive(tenantId: string): Promise<EntityRow[]> {
  return db
    .select()
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), isNull(entities.archivedAt)))
    .orderBy(asc(entities.position), asc(entities.createdAt))
    .for('update')
}

/**
 * Set the display order: `ids` must be every live Entity exactly once, in the
 * order wanted. Anything else is refused rather than guessed at, because a
 * screen that sent a stale list should reload, not silently drop a line.
 */
export async function reorderEntities(tenantId: string, ids: string[]): Promise<EntityWithUsage[]> {
  const live = await lockLive(tenantId)
  const wanted = new Set(ids)
  if (wanted.size !== ids.length || ids.length !== live.length || live.some(row => !wanted.has(row.id))) {
    throw new BadRequestError('entity_order_invalid')
  }
  for (const [position, id] of ids.entries()) {
    await db
      .update(entities)
      .set({ position, updatedAt: sql`now()` })
      .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id)))
  }
  return listEntities(tenantId, { includeArchived: false })
}

/**
 * Archive an Entity: it leaves the list and the member menus, and gives its
 * name and slug back. Refused for the studio's last live Entity (a studio
 * always has one) and for one that still holds Class Types or packages.
 */
export async function archiveEntity(tenantId: string, id: string): Promise<EntityWithUsage> {
  const live = await lockLive(tenantId)
  // An archived Entity is as good as gone: archiving it again answers as for an unknown id.
  if (!live.some(row => row.id === id)) throw new NotFoundError('entity_not_found')
  if (live.length === 1) throw new ConflictError('cannot_archive_last_entity')
  assertEntityUnused(await usageOf(tenantId, id))
  await db
    .update(entities)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id)))
  return getEntity(tenantId, id)
}

export async function listEntities(
  tenantId: string,
  opts: { includeArchived: boolean },
): Promise<EntityWithUsage[]> {
  const conds = [eq(entities.tenantId, tenantId)]
  if (!opts.includeArchived) conds.push(isNull(entities.archivedAt))
  const rows = await db
    .select()
    .from(entities)
    .where(and(...conds))
    .orderBy(asc(entities.position), asc(entities.createdAt))
  return Promise.all(rows.map(row => withUsage(tenantId, row)))
}
