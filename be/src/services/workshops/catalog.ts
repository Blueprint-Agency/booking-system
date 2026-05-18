import { eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { env } from '../../env'
import {
  workshops,
  workshopDays,
  workshopTiers,
  workshopTierDays,
  workshopImages,
  workshopInstructors,
} from '../../db/schema/schedule'
import { locations, classTypes, instructors } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import {
  bestPrice,
  listActivePromotionsFor,
  serializePromotion,
} from '../packages/promotions'
import { NotFoundError } from '../../shared/errors'

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

interface ClassTypeLite {
  id: string
  name: string
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
  class_type: ClassTypeLite | null
  location: LocationLite | null
  cover_url: string | null
  starts_at: Date | null
  ends_at: Date | null
  min_price_sgd: string | null
  has_discount: boolean
  days_count: number
  tiers_count: number
}

interface WorkshopDetailPayload extends WorkshopCardPayload {
  images: { id: string; url: string | null; ord: number }[]
  days: DayPayload[]
  tiers: TierPayload[]
  instructors: InstructorLite[]
}

async function loadCommon(workshopIds: string[]) {
  if (workshopIds.length === 0) {
    return {
      daysByWorkshop: new Map<string, DayPayload[]>(),
      tiersByWorkshop: new Map<string, TierPayload[]>(),
      locationById: new Map<string, LocationLite>(),
      classTypeById: new Map<string, ClassTypeLite>(),
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
  ct: ClassTypeLite | null,
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
  return {
    id: w.id,
    name: w.name,
    description_html: w.descriptionHtml ?? null,
    lifecycle: w.lifecycle,
    class_type: ct,
    location: loc,
    cover_url: r2Url(w.coverR2Key),
    starts_at: startsAt,
    ends_at: endsAt,
    min_price_sgd: min !== null ? min.toFixed(2) : null,
    has_discount: hasDiscount,
    days_count: days.length,
    tiers_count: tiers.length,
  }
}

export async function listActiveWorkshopCards(): Promise<WorkshopCardPayload[]> {
  const ws = await db.select().from(workshops).where(eq(workshops.lifecycle, 'active'))
  if (ws.length === 0) return []

  const workshopIds = ws.map(w => w.id)
  const { daysByWorkshop, tiersByWorkshop } = await loadCommon(workshopIds)

  // Resolve location + class_type for all in one round-trip each.
  const locIds = Array.from(new Set(ws.map(w => w.locationId)))
  const ctIds = Array.from(new Set(ws.map(w => w.classTypeId)))
  const locRows = await db.select().from(locations).where(inArray(locations.id, locIds))
  const ctRows = await db.select().from(classTypes).where(inArray(classTypes.id, ctIds))
  const locById = new Map(
    locRows.map(l => [l.id, { id: l.id, name: l.name, address: l.address }]),
  )
  const ctById = new Map(ctRows.map(c => [c.id, { id: c.id, name: c.name }]))

  const cards: WorkshopCardPayload[] = []
  for (const w of ws) {
    cards.push(
      await buildCard(
        w,
        daysByWorkshop.get(w.id) ?? [],
        tiersByWorkshop.get(w.id) ?? [],
        locById.get(w.locationId) ?? null,
        ctById.get(w.classTypeId) ?? null,
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

export async function getWorkshopDetailPayload(id: string): Promise<WorkshopDetailPayload> {
  const [w] = await db.select().from(workshops).where(eq(workshops.id, id)).limit(1)
  if (!w) throw new NotFoundError('workshop_not_found')

  const { daysByWorkshop, tiersByWorkshop } = await loadCommon([w.id])
  const days = daysByWorkshop.get(w.id) ?? []
  const tiers = tiersByWorkshop.get(w.id) ?? []

  const [locRow] = await db.select().from(locations).where(eq(locations.id, w.locationId)).limit(1)
  const [ctRow] = await db
    .select()
    .from(classTypes)
    .where(eq(classTypes.id, w.classTypeId))
    .limit(1)

  const imageRows = await db
    .select()
    .from(workshopImages)
    .where(eq(workshopImages.workshopId, w.id))
    .orderBy(workshopImages.ord)

  const instructorIdsRows = await db
    .select({ id: workshopInstructors.instructorId })
    .from(workshopInstructors)
    .where(eq(workshopInstructors.workshopId, w.id))
  const instructorIds = instructorIdsRows.map(r => r.id)

  let instructorPayload: InstructorLite[] = []
  if (instructorIds.length) {
    const rows = await db
      .select({
        id: instructors.staffUserId,
        bio: instructors.bio,
        photoR2Key: instructors.photoR2Key,
        name: staffUsers.name,
      })
      .from(instructors)
      .innerJoin(staffUsers, eq(staffUsers.id, instructors.staffUserId))
      .where(inArray(instructors.staffUserId, instructorIds))
    instructorPayload = rows.map(r => ({
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
    ctRow ? { id: ctRow.id, name: ctRow.name } : null,
  )

  return {
    ...card,
    images: imageRows.map(im => ({ id: im.id, url: r2Url(im.r2Key), ord: im.ord })),
    days,
    tiers,
    instructors: instructorPayload,
  }
}
