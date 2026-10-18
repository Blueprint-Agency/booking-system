import { and, asc, eq, ne } from 'drizzle-orm'
import { db } from '../../db'
import { classpassLocationMappings, locations } from '../../db/schema'
import { isUniqueViolation } from '../../db/unique-violation'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { normaliseClassPassLocation } from './location-name'

/**
 * ClassPass location mappings (#410): which of the studio's Locations each
 * name ClassPass writes in its emails means. Names are stored normalised
 * (`normaliseClassPassLocation`), so the import (#411) finds a mapping by
 * normalising the email's name the same way.
 */

export { normaliseClassPassLocation } from './location-name'

export type ClassPassLocationMapping = {
  id: string
  /** Normalised. */
  locationName: string
  locationId: string
  /** The Location's own name, and whether it is archived, for the page. */
  location: { name: string; archivedAt: Date | null }
  createdAt: Date
  updatedAt: Date
}

const NAME_UNIQUE = 'classpass_location_mappings_name_unique'

function normalisedName(raw: string): string {
  const name = normaliseClassPassLocation(raw)
  if (!name) throw new BadRequestError('classpass_location_name_required')
  return name
}

/** A Location a mapping may point at: this studio's, neither archived nor deleted. */
async function assertMappableLocation(tenantId: string, locationId: string): Promise<void> {
  const [row] = await db
    .select({ archivedAt: locations.archivedAt, deletedAt: locations.deletedAt })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
  // Another studio's Location is not found, never forbidden.
  if (!row || row.deletedAt) throw new NotFoundError('location_not_found')
  if (row.archivedAt) throw new BadRequestError('location_archived', { location_id: locationId })
}

async function assertNameFree(tenantId: string, name: string, exceptId?: string): Promise<void> {
  const [taken] = await db
    .select({ id: classpassLocationMappings.id })
    .from(classpassLocationMappings)
    .where(
      and(
        eq(classpassLocationMappings.tenantId, tenantId),
        eq(classpassLocationMappings.locationName, name),
        exceptId ? ne(classpassLocationMappings.id, exceptId) : undefined,
      ),
    )
  if (taken) throw new ConflictError('classpass_mapping_exists', { mapping_id: taken.id })
}

export async function listClassPassLocationMappings(tenantId: string): Promise<ClassPassLocationMapping[]> {
  const rows = await db
    .select({
      mapping: classpassLocationMappings,
      locationName: locations.name,
      locationArchivedAt: locations.archivedAt,
    })
    .from(classpassLocationMappings)
    .innerJoin(locations, eq(locations.id, classpassLocationMappings.locationId))
    .where(eq(classpassLocationMappings.tenantId, tenantId))
    .orderBy(asc(classpassLocationMappings.locationName))
  return rows.map(r => ({
    id: r.mapping.id,
    locationName: r.mapping.locationName,
    locationId: r.mapping.locationId,
    location: { name: r.locationName, archivedAt: r.locationArchivedAt },
    createdAt: r.mapping.createdAt,
    updatedAt: r.mapping.updatedAt,
  }))
}

async function readMapping(tenantId: string, id: string): Promise<ClassPassLocationMapping> {
  const found = (await listClassPassLocationMappings(tenantId)).find(m => m.id === id)
  if (!found) throw new NotFoundError('classpass_mapping_not_found')
  return found
}

export async function addClassPassLocationMapping(
  tenantId: string,
  input: { locationName: string; locationId: string },
): Promise<ClassPassLocationMapping> {
  const locationName = normalisedName(input.locationName)
  await assertMappableLocation(tenantId, input.locationId)
  await assertNameFree(tenantId, locationName)
  try {
    const [row] = await db
      .insert(classpassLocationMappings)
      .values({ tenantId, locationName, locationId: input.locationId })
      .returning({ id: classpassLocationMappings.id })
    return readMapping(tenantId, row!.id)
  } catch (err) {
    // Lost a race with an Admin adding the same name.
    if (isUniqueViolation(err, NAME_UNIQUE)) throw new ConflictError('classpass_mapping_exists')
    throw err
  }
}

export async function changeClassPassLocationMapping(
  tenantId: string,
  id: string,
  patch: { locationName?: string; locationId?: string },
): Promise<ClassPassLocationMapping> {
  await readMapping(tenantId, id)
  const set: { locationName?: string; locationId?: string; updatedAt: Date } = { updatedAt: new Date() }
  if (patch.locationName !== undefined) {
    set.locationName = normalisedName(patch.locationName)
    await assertNameFree(tenantId, set.locationName, id)
  }
  if (patch.locationId !== undefined) {
    await assertMappableLocation(tenantId, patch.locationId)
    set.locationId = patch.locationId
  }
  try {
    await db
      .update(classpassLocationMappings)
      .set(set)
      .where(and(eq(classpassLocationMappings.tenantId, tenantId), eq(classpassLocationMappings.id, id)))
  } catch (err) {
    if (isUniqueViolation(err, NAME_UNIQUE)) throw new ConflictError('classpass_mapping_exists')
    throw err
  }
  return readMapping(tenantId, id)
}

export async function removeClassPassLocationMapping(tenantId: string, id: string): Promise<void> {
  const removed = await db
    .delete(classpassLocationMappings)
    .where(and(eq(classpassLocationMappings.tenantId, tenantId), eq(classpassLocationMappings.id, id)))
    .returning({ id: classpassLocationMappings.id })
  if (!removed.length) throw new NotFoundError('classpass_mapping_not_found')
}
