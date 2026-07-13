import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { locations, instructors } from '../../db/schema/catalog'
import {
  workshops,
  workshopInstructors,
  workshopImages,
  workshopDays,
  workshopTiers,
  workshopTierDays,
} from '../../db/schema/schedule'
import { BadRequestError, NotFoundError } from '../../shared/errors'

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

function normalizeSupporting(
  mainInstructorId: string,
  supportingInstructorIds: string[] | undefined,
): string[] {
  const supports = Array.from(new Set(supportingInstructorIds ?? []))
  if (supports.includes(mainInstructorId)) {
    throw new BadRequestError('main_instructor_cannot_be_supporting')
  }
  return supports
}

export interface WorkshopInstructorInput {
  instructorId: string
  /** null/undefined = unpriced. */
  paySgd?: number | null
}

function normalizeSupportingWithPay(
  mainInstructorId: string,
  supports: WorkshopInstructorInput[] | undefined,
): { instructorId: string; paySgd: number | null }[] {
  const byId = new Map<string, number | null>()
  for (const s of supports ?? []) byId.set(s.instructorId, s.paySgd ?? null)
  const result = Array.from(byId, ([instructorId, paySgd]) => ({ instructorId, paySgd }))
  if (result.some(r => r.instructorId === mainInstructorId)) {
    throw new BadRequestError('main_instructor_cannot_be_supporting')
  }
  return result
}

function toNumeric(n: number | null): string | null {
  return n == null ? null : n.toFixed(2)
}

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

async function ensureInstructors(ids: string[]) {
  if (!ids.length) return
  const found = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .innerJoin(instructors, eq(instructors.staffUserId, staffUsers.id))
    .where(
      and(
        inArray(staffUsers.id, ids),
        eq(staffUsers.status, 'active'),
        isNull(staffUsers.deletedAt),
      ),
    )
  if (found.length !== ids.length) {
    throw new BadRequestError('invalid_instructor_ids', {
      invalid: ids.filter(id => !found.find(f => f.id === id)),
    })
  }
}

export async function createWorkshop(input: CreateWorkshopInput): Promise<WorkshopRow> {
  if (!input.mainInstructorId) {
    throw new BadRequestError('main_instructor_id_required')
  }
  await ensureLocation(input.locationId)
  const supports = normalizeSupporting(input.mainInstructorId, input.supportingInstructorIds)
  await ensureInstructors([input.mainInstructorId, ...supports])

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

    await tx.insert(workshopInstructors).values([
      { workshopId: row!.id, instructorId: input.mainInstructorId, role: 'main' as const },
      ...supports.map(instructorId => ({
        workshopId: row!.id,
        instructorId,
        role: 'supporting' as const,
      })),
    ])

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
  /** undefined = leave unchanged; null = clear; number = set (SGD). Only applies when the main instructor row is touched. */
  mainInstructorPaySgd?: number | null
  supportingInstructors?: WorkshopInstructorInput[]
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

  // Resolve the instructor roster shape we're going to write, if any touch was requested.
  const touchingInstructors =
    patch.mainInstructorId !== undefined ||
    patch.supportingInstructors !== undefined ||
    patch.mainInstructorPaySgd !== undefined

  let resolvedMainId: string | null = null
  let resolvedMainPaySgd: number | null = null
  let resolvedSupports: { instructorId: string; paySgd: number | null }[] = []
  if (touchingInstructors) {
    const [currentMain] = await db
      .select({ id: workshopInstructors.instructorId, paySgd: workshopInstructors.paySgd })
      .from(workshopInstructors)
      .where(and(eq(workshopInstructors.workshopId, id), eq(workshopInstructors.role, 'main')))
      .limit(1)

    if (patch.mainInstructorId !== undefined) {
      resolvedMainId = patch.mainInstructorId
      // New main instructor and no explicit pay given → unpriced, don't carry
      // over the previous main's dollar amount to a different person.
      resolvedMainPaySgd =
        patch.mainInstructorPaySgd !== undefined ? patch.mainInstructorPaySgd ?? null : null
    } else {
      // Re-use existing main when only supporting list / pay is being patched.
      if (!currentMain) throw new BadRequestError('workshop_has_no_main_instructor')
      resolvedMainId = currentMain.id
      resolvedMainPaySgd =
        patch.mainInstructorPaySgd !== undefined
          ? patch.mainInstructorPaySgd ?? null
          : currentMain.paySgd == null
            ? null
            : Number(currentMain.paySgd)
    }
    if (!resolvedMainId) throw new BadRequestError('main_instructor_id_required')

    const supportsInput =
      patch.supportingInstructors !== undefined
        ? patch.supportingInstructors
        : (
            await db
              .select({ id: workshopInstructors.instructorId, paySgd: workshopInstructors.paySgd })
              .from(workshopInstructors)
              .where(
                and(
                  eq(workshopInstructors.workshopId, id),
                  eq(workshopInstructors.role, 'supporting'),
                ),
              )
          ).map(r => ({
            instructorId: r.id,
            paySgd: r.paySgd == null ? null : Number(r.paySgd),
          }))
    resolvedSupports = normalizeSupportingWithPay(resolvedMainId, supportsInput)
    await ensureInstructors([resolvedMainId, ...resolvedSupports.map(s => s.instructorId)])
  }

  await db.transaction(async tx => {
    const set: Partial<typeof workshops.$inferInsert> = {}
    if (patch.name !== undefined) set.name = patch.name
    if (patch.locationId !== undefined) set.locationId = patch.locationId
    if (patch.descriptionHtml !== undefined) set.descriptionHtml = patch.descriptionHtml
    if (patch.coverR2Key !== undefined) set.coverR2Key = patch.coverR2Key
    if (Object.keys(set).length) {
      await tx.update(workshops).set(set).where(eq(workshops.id, id))
    }

    if (touchingInstructors && resolvedMainId) {
      await tx.delete(workshopInstructors).where(eq(workshopInstructors.workshopId, id))
      await tx.insert(workshopInstructors).values([
        {
          workshopId: id,
          instructorId: resolvedMainId,
          role: 'main' as const,
          paySgd: toNumeric(resolvedMainPaySgd),
        },
        ...resolvedSupports.map(s => ({
          workshopId: id,
          instructorId: s.instructorId,
          role: 'supporting' as const,
          paySgd: toNumeric(s.paySgd),
        })),
      ])
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

// Backwards-compat — the old stub signature took capacity-based tiers; v0 splits
// creation into POST workshop basics + nested POST /days + POST /tiers.
// publishWorkshop is left as a thin wrapper that just creates the basics.
export type PublishWorkshopInput = CreateWorkshopInput
export async function publishWorkshop(input: PublishWorkshopInput): Promise<{ workshopId: string }> {
  const row = await createWorkshop(input)
  return { workshopId: row.id }
}
