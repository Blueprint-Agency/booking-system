import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { env } from '../../env'
import {
  workshops,
  workshopDays,
  workshopTiers,
  workshopTierDays,
  workshopImages,
} from '../../db/schema/schedule'
import { locations, instructors } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import {
  bestPrice,
  listActivePromotionsFor,
  serializePromotion,
} from '../packages/promotions'
import { NotFoundError } from '../../shared/errors'
import { readRoster, readRosters } from '../schedule/roster'
import { lineupOf, lineupsOf, type Lineup } from '../schedule/lineup'

export type WorkshopRow = typeof workshops.$inferSelect

function r2Url(key: string | null | undefined): string | null {
  if (!key) return null
  if (!env.R2_PUBLIC_URL) return null
  return `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key.replace(/^\//, '')}`
}

interface InstructorLite {
  id: string
  name: string
  bio: string | null
  avatar_url: string | null
}

interface LocationLite {
  id: string
  name: string
  address: string | null
}

interface DayPayload {
  id: string
  ord: number
  starts_at: Date
  ends_at: Date
  capacity_online: number
  capacity_waitlist: number
  capacity_buffer: number
}

interface TierPayload {
  id: string
  name: string
  description: string | null
  regular_price_sgd: string
  early_bird_price_sgd: string | null
  early_bird_cutoff_at: Date | null
  early_bird_quota: number | null
  effective_price_sgd: string
  applied_promotion_id: string | null
  ord: number
  day_ids: string[]
  promotions: ReturnType<typeof serializePromotion>[]
}

interface WorkshopCardPayload {
  id: string
  name: string
  description_html: string | null
  lifecycle: string
  location: LocationLite | null
  cover_url: string | null
  starts_at: Date | null
  ends_at: Date | null
  min_price_sgd: string | null
  has_discount: boolean
  days_count: number
  tiers_count: number
  main_instructor_id: string | null
  supporting_instructor_ids: string[]
  /** Back-compat — [main, ...supporting]. */
  instructor_ids: string[]
}

interface WorkshopDetailPayload extends WorkshopCardPayload {
  images: { id: string; url: string | null; ord: number }[]
  days: DayPayload[]
  tiers: TierPayload[]
  instructors: InstructorLite[]
  main_instructor_id: string | null
  supporting_instructor_ids: string[]
  /** Back-compat — [main, ...supporting]. */
  instructor_ids: string[]
}

async function loadCommon(workshopIds: string[]) {
  if (workshopIds.length === 0) {
    return {
      daysByWorkshop: new Map<string, DayPayload[]>(),
      tiersByWorkshop: new Map<string, TierPayload[]>(),
      locationById: new Map<string, LocationLite>(),
    }
  }

  const daysRows = await db
    .select()
    .from(workshopDays)
    .where(inArray(workshopDays.workshopId, workshopIds))
    .orderBy(workshopDays.ord)
  const daysByWorkshop = new Map<string, DayPayload[]>()
  for (const d of daysRows) {
    const list = daysByWorkshop.get(d.workshopId) ?? []
    list.push({
      id: d.id,
      ord: d.ord,
      starts_at: d.startsAt,
      ends_at: d.endsAt,
      capacity_online: d.capacityOnline,
      capacity_waitlist: d.capacityWaitlist,
      capacity_buffer: d.capacityBuffer,
    })
    daysByWorkshop.set(d.workshopId, list)
  }

  const tierRows = await db
    .select()
    .from(workshopTiers)
    .where(inArray(workshopTiers.workshopId, workshopIds))
    .orderBy(workshopTiers.ord)
  const tierIds = tierRows.map(t => t.id)
  const tierDayRows = tierIds.length
    ? await db
        .select()
        .from(workshopTierDays)
        .where(inArray(workshopTierDays.workshopTierId, tierIds))
    : []
  const dayIdsByTier = new Map<string, string[]>()
  for (const td of tierDayRows) {
    const list = dayIdsByTier.get(td.workshopTierId) ?? []
    list.push(td.workshopDayId)
    dayIdsByTier.set(td.workshopTierId, list)
  }

  // Promotions are scoped per-workshop (parent_type='workshop', parent_id=workshop.id)
  // — applied uniformly to all tiers of that workshop.
  const promosByWorkshop = await listActivePromotionsFor('workshop', workshopIds)

  const tiersByWorkshop = new Map<string, TierPayload[]>()
  for (const t of tierRows) {
    const wsPromos = promosByWorkshop[t.workshopId] ?? []
    const eff = bestPrice(t.regularPriceSgd, wsPromos)
    const list = tiersByWorkshop.get(t.workshopId) ?? []
    list.push({
      id: t.id,
      name: t.name,
      description: t.description,
      regular_price_sgd: t.regularPriceSgd,
      early_bird_price_sgd: t.earlyBirdPriceSgd,
      early_bird_cutoff_at: t.earlyBirdCutoffAt,
      early_bird_quota: t.earlyBirdQuota,
      effective_price_sgd: eff.effectivePriceSgd,
      applied_promotion_id: eff.appliedPromotionId,
      ord: t.ord,
      day_ids: dayIdsByTier.get(t.id) ?? [],
      promotions: wsPromos.map(serializePromotion),
    })
    tiersByWorkshop.set(t.workshopId, list)
  }

  return { daysByWorkshop, tiersByWorkshop }
}

async function buildCard(
  w: WorkshopRow,
  days: DayPayload[],
  tiers: TierPayload[],
  loc: LocationLite | null,
  instructorInfo: Lineup = { mainInstructorId: null, supportingInstructorIds: [], instructorIds: [] },
): Promise<WorkshopCardPayload> {
  const startsAt = days.length ? days[0]!.starts_at : null
  const endsAt = days.length ? days[days.length - 1]!.ends_at : null
  let min: number | null = null
  let hasDiscount = false
  for (const t of tiers) {
    const candidates: number[] = [Number(t.effective_price_sgd)]
    if (t.early_bird_price_sgd != null) candidates.push(Number(t.early_bird_price_sgd))
    const tierMin = Math.min(...candidates)
    if (min === null || tierMin < min) min = tierMin
    if (Number(t.effective_price_sgd) < Number(t.regular_price_sgd)) hasDiscount = true
  }
  const instructor_ids = instructorInfo.instructorIds
  return {
    id: w.id,
    name: w.name,
    description_html: w.descriptionHtml ?? null,
    lifecycle: w.lifecycle,
    location: loc,
    cover_url: r2Url(w.coverR2Key),
    starts_at: startsAt,
    ends_at: endsAt,
    min_price_sgd: min !== null ? min.toFixed(2) : null,
    has_discount: hasDiscount,
    days_count: days.length,
    tiers_count: tiers.length,
    main_instructor_id: instructorInfo.mainInstructorId,
    supporting_instructor_ids: instructorInfo.supportingInstructorIds,
    instructor_ids,
  }
}

async function loadInstructorRolesByWorkshop(
  tenantId: string,
  workshopIds: string[],
): Promise<Map<string, Lineup>> {
  return lineupsOf(await readRosters(tenantId, 'workshop', workshopIds))
}

export async function listActiveWorkshopCards(tenantId: string): Promise<WorkshopCardPayload[]> {
  const ws = await db
    .select()
    .from(workshops)
    .where(and(eq(workshops.tenantId, tenantId), eq(workshops.lifecycle, 'active')))
  if (ws.length === 0) return []

  const workshopIds = ws.map(w => w.id)
  const { daysByWorkshop, tiersByWorkshop } = await loadCommon(workshopIds)
  const instructorMap = await loadInstructorRolesByWorkshop(tenantId, workshopIds)

  // Resolve location for all in one round-trip.
  const locIds = Array.from(new Set(ws.map(w => w.locationId)))
  const locRows = await db
    .select()
    .from(locations)
    .where(and(inArray(locations.id, locIds), isNull(locations.deletedAt)))
  const locById = new Map(
    locRows.map(l => [l.id, { id: l.id, name: l.name, address: l.address }]),
  )

  const cards: WorkshopCardPayload[] = []
  for (const w of ws) {
    cards.push(
      await buildCard(
        w,
        daysByWorkshop.get(w.id) ?? [],
        tiersByWorkshop.get(w.id) ?? [],
        locById.get(w.locationId) ?? null,
        instructorMap.get(w.id),
      ),
    )
  }
  // Sort by earliest day asc.
  cards.sort((a, b) => {
    const av = a.starts_at?.getTime() ?? Number.POSITIVE_INFINITY
    const bv = b.starts_at?.getTime() ?? Number.POSITIVE_INFINITY
    return av - bv
  })
  return cards
}

export async function getWorkshopDetailPayload(
  tenantId: string,
  id: string,
): Promise<WorkshopDetailPayload> {
  // The card list is tenant-scoped, so the detail behind it has to be too — a
  // scoped list beside an unscoped detail just moves the leak one click away.
  const [w] = await db
    .select()
    .from(workshops)
    .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, id)))
    .limit(1)
  if (!w) throw new NotFoundError('workshop_not_found')

  const { daysByWorkshop, tiersByWorkshop } = await loadCommon([w.id])
  const days = daysByWorkshop.get(w.id) ?? []
  const tiers = tiersByWorkshop.get(w.id) ?? []

  const [locRow] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, w.locationId), isNull(locations.deletedAt)))
    .limit(1)

  const imageRows = await db
    .select()
    .from(workshopImages)
    .where(eq(workshopImages.workshopId, w.id))
    .orderBy(workshopImages.ord)

  const lineup = lineupOf(await readRoster(w.tenantId!, { kind: 'workshop', id: w.id }))
  const { instructorIds } = lineup

  let instructorPayload: InstructorLite[] = []
  if (instructorIds.length) {
    const rows = await db
      .select({
        id: instructors.staffUserId,
        bio: staffUsers.bio,
        photoR2Key: instructors.photoR2Key,
        name: staffUsers.name,
      })
      .from(instructors)
      .innerJoin(staffUsers, eq(staffUsers.id, instructors.staffUserId))
      .where(
        and(
          inArray(instructors.staffUserId, instructorIds),
          isNull(staffUsers.deletedAt),
        ),
      )
    const byId = new Map(rows.map(r => [r.id, r]))
    // Preserve [main, ...supporting] ordering.
    instructorPayload = instructorIds
      .map(id => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(r => ({
        id: r.id,
        name: r.name || 'Instructor',
        bio: r.bio,
        avatar_url: r2Url(r.photoR2Key),
      }))
  }

  const card = await buildCard(
    w,
    days,
    tiers,
    locRow ? { id: locRow.id, name: locRow.name, address: locRow.address } : null,
    lineup,
  )

  return {
    ...card,
    images: imageRows.map(im => ({ id: im.id, url: r2Url(im.r2Key), ord: im.ord })),
    days,
    tiers,
    instructors: instructorPayload,
    main_instructor_id: lineup.mainInstructorId,
    supporting_instructor_ids: lineup.supportingInstructorIds,
    instructor_ids: instructorIds,
  }
}
