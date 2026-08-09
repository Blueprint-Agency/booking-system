import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { locations } from '../../db/schema/catalog'
import {
  workshops,
  workshopInstructors,
  workshopImages,
  workshopDays,
  workshopTiers,
  workshopTierDays,
} from '../../db/schema/schedule'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { replaceRoster, type RosterAssignment } from '../schedule/roster'

export type WorkshopRow = typeof workshops.$inferSelect

export interface CreateWorkshopInput {
  name: string
  locationId: string
  descriptionHtml?: string | null
  coverR2Key?: string | null
  mainInstructorId: string
  supportingInstructorIds?: string[]
  imageR2Keys?: string[]
  createdByStaffId: string
}

/**
 * One supporting instructor as the caller supplies them. Omitting `paySgd`
 * means "leave whatever is recorded alone" — see services/schedule/roster.ts.
 */
export type WorkshopInstructorInput = RosterAssignment

async function ensureLocation(id: string) {
  const [r] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.id, id),
        isNull(locations.archivedAt),
        isNull(locations.deletedAt),
      ),
    )
    .limit(1)
  if (!r) throw new BadRequestError('invalid_location_id')
}

export async function createWorkshop(input: CreateWorkshopInput): Promise<WorkshopRow> {
  if (!input.mainInstructorId) {
    throw new BadRequestError('main_instructor_id_required')
  }
  await ensureLocation(input.locationId)

  return db.transaction(async tx => {
    const [row] = await tx
      .insert(workshops)
      .values({
        name: input.name,
        locationId: input.locationId,
        descriptionHtml: input.descriptionHtml ?? null,
        coverR2Key: input.coverR2Key ?? null,
        createdByStaffId: input.createdByStaffId,
        lifecycle: 'active',
      })
      .returning()

    // Instructor validation, dedup and the main-cannot-be-supporting rule all
    // live in the roster module — nothing to pre-check here.
    await replaceRoster(
      tx,
      { kind: 'workshop', id: row!.id },
      {
        main: { instructorId: input.mainInstructorId },
        supportingInstructorIds: input.supportingInstructorIds ?? [],
      },
    )

    if (input.imageR2Keys?.length) {
      await tx.insert(workshopImages).values(
        input.imageR2Keys.map((r2Key, i) => ({
          workshopId: row!.id,
          r2Key,
          ord: i + 1,
        })),
      )
    }
    return row!
  })
}

export interface UpdateWorkshopInput {
  name?: string
  locationId?: string
  descriptionHtml?: string | null
  coverR2Key?: string | null
  mainInstructorId?: string
  /** undefined = leave unchanged; null = clear; number = set (SGD). */
  mainInstructorPaySgd?: number | null
  /** Preferred — per-instructor pay. `supportingInstructorIds` (bare ids) is the older shape. */
  supportingInstructors?: WorkshopInstructorInput[]
  supportingInstructorIds?: string[]
  imageR2Keys?: string[]
}

export async function getWorkshop(id: string): Promise<WorkshopRow> {
  const [row] = await db.select().from(workshops).where(eq(workshops.id, id)).limit(1)
  if (!row) throw new NotFoundError('workshop_not_found')
  return row
}

export async function updateWorkshop(id: string, patch: UpdateWorkshopInput): Promise<WorkshopRow> {
  const existing = await getWorkshop(id)
  if (existing.lifecycle === 'cancelled') {
    throw new BadRequestError('workshop_cancelled')
  }
  if (patch.locationId !== undefined) await ensureLocation(patch.locationId)

  // Who is on the workshop, and what they're paid, belongs to the roster module —
  // including the role='main' row, which it treats as any other main instructor.
  const touchesMain =
    patch.mainInstructorId !== undefined || patch.mainInstructorPaySgd !== undefined
  const touchesRoster =
    touchesMain ||
    patch.supportingInstructors !== undefined ||
    patch.supportingInstructorIds !== undefined

  await db.transaction(async tx => {
    const set: Partial<typeof workshops.$inferInsert> = {}
    if (patch.name !== undefined) set.name = patch.name
    if (patch.locationId !== undefined) set.locationId = patch.locationId
    if (patch.descriptionHtml !== undefined) set.descriptionHtml = patch.descriptionHtml
    if (patch.coverR2Key !== undefined) set.coverR2Key = patch.coverR2Key
    if (Object.keys(set).length) {
      await tx.update(workshops).set(set).where(eq(workshops.id, id))
    }

    if (touchesRoster) {
      const roster = await replaceRoster(
        tx,
        { kind: 'workshop', id },
        {
          ...(touchesMain
            ? {
                main: {
                  ...(patch.mainInstructorId !== undefined
                    ? { instructorId: patch.mainInstructorId }
                    : {}),
                  ...(patch.mainInstructorPaySgd !== undefined
                    ? { paySgd: patch.mainInstructorPaySgd }
                    : {}),
                },
              }
            : {}),
          ...(patch.supportingInstructors !== undefined
            ? { supporting: patch.supportingInstructors }
            : {}),
          ...(patch.supportingInstructorIds !== undefined
            ? { supportingInstructorIds: patch.supportingInstructorIds }
            : {}),
        },
      )
      // A workshop with no main row is a broken row, not a state to save into.
      if (!roster.some(r => r.role === 'main')) {
        throw new BadRequestError('workshop_has_no_main_instructor')
      }
    }

    if (patch.imageR2Keys !== undefined) {
      await tx.delete(workshopImages).where(eq(workshopImages.workshopId, id))
      if (patch.imageR2Keys.length) {
        await tx.insert(workshopImages).values(
          patch.imageR2Keys.map((r2Key, i) => ({
            workshopId: id,
            r2Key,
            ord: i + 1,
          })),
        )
      }
    }
  })

  return getWorkshop(id)
}

export async function listWorkshops(opts: { lifecycle?: 'active' | 'cancelled' }): Promise<WorkshopRow[]> {
  if (opts.lifecycle) {
    return db.select().from(workshops).where(eq(workshops.lifecycle, opts.lifecycle))
  }
  return db.select().from(workshops)
}

export async function listInstructorsByWorkshop(
  workshopIds: string[],
): Promise<Map<string, { mainInstructorId: string | null; supportingInstructorIds: string[] }>> {
  const map = new Map<string, { mainInstructorId: string | null; supportingInstructorIds: string[] }>()
  if (!workshopIds.length) return map
  const rows = await db
    .select({
      workshopId: workshopInstructors.workshopId,
      instructorId: workshopInstructors.instructorId,
      role: workshopInstructors.role,
    })
    .from(workshopInstructors)
    .where(inArray(workshopInstructors.workshopId, workshopIds))
  for (const r of rows) {
    let entry = map.get(r.workshopId)
    if (!entry) {
      entry = { mainInstructorId: null, supportingInstructorIds: [] }
      map.set(r.workshopId, entry)
    }
    if (r.role === 'main') entry.mainInstructorId = r.instructorId
    else entry.supportingInstructorIds.push(r.instructorId)
  }
  for (const entry of map.values()) entry.supportingInstructorIds.sort()
  return map
}

export interface WorkshopDetailView {
  workshop: WorkshopRow
  days: Array<typeof workshopDays.$inferSelect>
  tiers: Array<typeof workshopTiers.$inferSelect & { dayIds: string[] }>
  images: Array<typeof workshopImages.$inferSelect>
  mainInstructorId: string | null
  supportingInstructorIds: string[]
  /** Back-compat — [main, ...supporting]. */
  instructorIds: string[]
  mainInstructorPaySgd: number | null
  supportingInstructors: { instructorId: string; paySgd: number | null }[]
}

export async function getWorkshopDetail(id: string): Promise<WorkshopDetailView> {
  const workshop = await getWorkshop(id)
  const days = await db
    .select()
    .from(workshopDays)
    .where(eq(workshopDays.workshopId, id))
    .orderBy(workshopDays.ord)

  const tiers = await db
    .select()
    .from(workshopTiers)
    .where(eq(workshopTiers.workshopId, id))
    .orderBy(workshopTiers.ord)

  const tierDays = tiers.length
    ? await db
        .select()
        .from(workshopTierDays)
        .where(inArray(workshopTierDays.workshopTierId, tiers.map(t => t.id)))
    : []
  const byTier = new Map<string, string[]>()
  for (const td of tierDays) {
    const list = byTier.get(td.workshopTierId) ?? []
    list.push(td.workshopDayId)
    byTier.set(td.workshopTierId, list)
  }

  const images = await db
    .select()
    .from(workshopImages)
    .where(eq(workshopImages.workshopId, id))
    .orderBy(workshopImages.ord)

  const instructorRows = await db
    .select({
      id: workshopInstructors.instructorId,
      role: workshopInstructors.role,
      paySgd: workshopInstructors.paySgd,
    })
    .from(workshopInstructors)
    .where(eq(workshopInstructors.workshopId, id))

  let mainInstructorId: string | null = null
  let mainInstructorPaySgd: number | null = null
  const supportingInstructorIds: string[] = []
  const supportingInstructors: { instructorId: string; paySgd: number | null }[] = []
  for (const r of instructorRows) {
    if (r.role === 'main') {
      mainInstructorId = r.id
      mainInstructorPaySgd = r.paySgd == null ? null : Number(r.paySgd)
    } else {
      supportingInstructorIds.push(r.id)
      supportingInstructors.push({
        instructorId: r.id,
        paySgd: r.paySgd == null ? null : Number(r.paySgd),
      })
    }
  }
  supportingInstructorIds.sort()
  supportingInstructors.sort((a, b) => a.instructorId.localeCompare(b.instructorId))

  return {
    workshop,
    days,
    tiers: tiers.map(t => ({ ...t, dayIds: byTier.get(t.id) ?? [] })),
    images,
    mainInstructorId,
    supportingInstructorIds,
    instructorIds: mainInstructorId
      ? [mainInstructorId, ...supportingInstructorIds]
      : [...supportingInstructorIds],
    mainInstructorPaySgd,
    supportingInstructors,
  }
}

