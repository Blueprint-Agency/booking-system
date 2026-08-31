import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  workshops,
  workshopDays,
  workshopTiers,
  workshopTierDays,
} from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors'
/**
 * The workshop exists **and is this tenant's**. Every entry point here starts
 * with it, so a workshop id borrowed from another studio is
 * `workshop_not_found` before any tier is read, written or deleted. One
 * definition, shared with ./days.ts.
 */
import { getWorkshop as ensureWorkshop } from './publish'

export type WorkshopTierRow = typeof workshopTiers.$inferSelect
export type WorkshopTierDayRow = typeof workshopTierDays.$inferSelect

export interface TierWithDays extends WorkshopTierRow {
  dayIds: string[]
}

export interface CreateTierInput {
  name: string
  description?: string | null
  regularPriceSgd: string
  earlyBirdPriceSgd?: string | null
  earlyBirdQuota?: number | null
  earlyBirdCutoffAt?: Date | null
  ord: number
  dayIds: string[] // workshop_day.id list covered by this tier
}


async function ensureDaysBelong(tenantId: string, workshopId: string, dayIds: string[]) {
  if (!dayIds.length) throw new BadRequestError('tier_must_cover_at_least_one_day')
  const found = await db
    .select({ id: workshopDays.id })
    .from(workshopDays)
    .where(
      and(
        eq(workshopDays.tenantId, tenantId),
        eq(workshopDays.workshopId, workshopId),
        inArray(workshopDays.id, dayIds),
      ),
    )
  if (found.length !== dayIds.length) {
    throw new BadRequestError('invalid_workshop_day_ids', {
      invalid: dayIds.filter(id => !found.find(f => f.id === id)),
    })
  }
}

export async function listTiers(tenantId: string, workshopId: string): Promise<TierWithDays[]> {
  await ensureWorkshop(tenantId, workshopId)
  const tiers = await db
    .select()
    .from(workshopTiers)
    .where(and(eq(workshopTiers.tenantId, tenantId), eq(workshopTiers.workshopId, workshopId)))
    .orderBy(workshopTiers.ord)

  if (!tiers.length) return []

  const tierIds = tiers.map(t => t.id)
  const tierDays = await db
    .select()
    .from(workshopTierDays)
    .where(
      and(
        eq(workshopTierDays.tenantId, tenantId),
        inArray(workshopTierDays.workshopTierId, tierIds),
      ),
    )

  const byTier = new Map<string, string[]>()
  for (const td of tierDays) {
    const list = byTier.get(td.workshopTierId) ?? []
    list.push(td.workshopDayId)
    byTier.set(td.workshopTierId, list)
  }

  return tiers.map(t => ({ ...t, dayIds: byTier.get(t.id) ?? [] }))
}

export async function createTier(
  tenantId: string,
  workshopId: string,
  input: CreateTierInput,
): Promise<TierWithDays> {
  await ensureWorkshop(tenantId, workshopId)
  await ensureDaysBelong(tenantId, workshopId, input.dayIds)

  return db.transaction(async tx => {
    const [tier] = await tx
      .insert(workshopTiers)
      .values({
        tenantId,
        workshopId,
        name: input.name,
        description: input.description ?? null,
        regularPriceSgd: input.regularPriceSgd,
        earlyBirdPriceSgd: input.earlyBirdPriceSgd ?? null,
        earlyBirdQuota: input.earlyBirdQuota ?? null,
        earlyBirdCutoffAt: input.earlyBirdCutoffAt ?? null,
        ord: input.ord,
      })
      .returning()

    await tx
      .insert(workshopTierDays)
      .values(
        input.dayIds.map(workshopDayId => ({ tenantId, workshopTierId: tier!.id, workshopDayId })),
      )

    return { ...tier!, dayIds: input.dayIds }
  })
}

export interface UpdateTierInput {
  name?: string
  description?: string | null
  regularPriceSgd?: string
  earlyBirdPriceSgd?: string | null
  earlyBirdQuota?: number | null
  earlyBirdCutoffAt?: Date | null
  ord?: number
  dayIds?: string[]
}

export async function updateTier(
  tenantId: string,
  workshopId: string,
  tierId: string,
  patch: UpdateTierInput,
): Promise<TierWithDays> {
  await ensureWorkshop(tenantId, workshopId)
  const [existing] = await db
    .select()
    .from(workshopTiers)
    .where(
      and(
        eq(workshopTiers.tenantId, tenantId),
        eq(workshopTiers.id, tierId),
        eq(workshopTiers.workshopId, workshopId),
      ),
    )
    .limit(1)
  if (!existing) throw new NotFoundError('workshop_tier_not_found')

  if (patch.dayIds) await ensureDaysBelong(tenantId, workshopId, patch.dayIds)

  await db.transaction(async tx => {
    await tx
      .update(workshopTiers)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.regularPriceSgd !== undefined ? { regularPriceSgd: patch.regularPriceSgd } : {}),
        ...(patch.earlyBirdPriceSgd !== undefined
          ? { earlyBirdPriceSgd: patch.earlyBirdPriceSgd }
          : {}),
        ...(patch.earlyBirdQuota !== undefined ? { earlyBirdQuota: patch.earlyBirdQuota } : {}),
        ...(patch.earlyBirdCutoffAt !== undefined
          ? { earlyBirdCutoffAt: patch.earlyBirdCutoffAt }
          : {}),
        ...(patch.ord !== undefined ? { ord: patch.ord } : {}),
      })
      .where(and(eq(workshopTiers.tenantId, tenantId), eq(workshopTiers.id, tierId)))

    if (patch.dayIds) {
      await tx
        .delete(workshopTierDays)
        .where(
          and(
            eq(workshopTierDays.tenantId, tenantId),
            eq(workshopTierDays.workshopTierId, tierId),
          ),
        )
      await tx
        .insert(workshopTierDays)
        .values(
          patch.dayIds.map(workshopDayId => ({ tenantId, workshopTierId: tierId, workshopDayId })),
        )
    }
  })

  const [refreshed] = await listTiers(tenantId, workshopId).then(list =>
    list.filter(t => t.id === tierId).map(t => t),
  )
  if (!refreshed) throw new NotFoundError('workshop_tier_not_found')
  return refreshed
}

export async function deleteTier(
  tenantId: string,
  workshopId: string,
  tierId: string,
): Promise<void> {
  await ensureWorkshop(tenantId, workshopId)
  const [existing] = await db
    .select()
    .from(workshopTiers)
    .where(
      and(
        eq(workshopTiers.tenantId, tenantId),
        eq(workshopTiers.id, tierId),
        eq(workshopTiers.workshopId, workshopId),
      ),
    )
    .limit(1)
  if (!existing) throw new NotFoundError('workshop_tier_not_found')

  const rows = await db
    .select({ n: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.workshopTierId, tierId),
        sql`${bookings.state} = 'confirmed'`,
      ),
    )
  const n = Number(rows[0]?.n ?? 0)
  if (n > 0) {
    throw new ConflictError('workshop_tier_has_bookings', { bookings: n })
  }

  await db.transaction(async tx => {
    await tx
      .delete(workshopTierDays)
      .where(
        and(eq(workshopTierDays.tenantId, tenantId), eq(workshopTierDays.workshopTierId, tierId)),
      )
    await tx
      .delete(workshopTiers)
      .where(and(eq(workshopTiers.tenantId, tenantId), eq(workshopTiers.id, tierId)))
  })
}
