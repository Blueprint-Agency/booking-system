import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  workshops,
  workshopDays,
  workshopTiers,
  workshopTierDays,
} from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { payableSalesOfWorkshopTier } from '../billing/open-purchases'
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors'
/**
 * The workshop exists **and is this tenant's**. Every entry point here starts
 * with it, so a workshop id borrowed from another studio is
 * `workshop_not_found` before any tier is read, written or deleted. One
 * definition, shared with ./days.ts.
 */
import { getWorkshop as ensureWorkshop } from './publish'

export type WorkshopTierRow = typeof workshopTiers.$inferSelect

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

/**
 * The workshop row, held until the caller's transaction ends, so a `deleteTier`
 * (which takes the same row `FOR UPDATE` before anything else) waits for a sale
 * the caller is about to record, and the caller's tier read after this waits
 * for a removal already under way.
 */
export async function holdWorkshopAgainstTierRemoval(
  tenantId: string,
  workshopId: string,
): Promise<typeof workshops.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(workshops)
    .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, workshopId)))
    .limit(1)
    .for('key share')
  return row
}

export async function deleteTier(
  tenantId: string,
  workshopId: string,
  tierId: string,
): Promise<void> {
  await db.transaction(async () => {
    await ensureWorkshop(tenantId, workshopId, { lock: true })
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

    const [{ tiers } = { tiers: 0 }] = await db
      .select({ tiers: count() })
      .from(workshopTiers)
      .where(and(eq(workshopTiers.tenantId, tenantId), eq(workshopTiers.workshopId, workshopId)))
    if (Number(tiers) <= 1) {
      throw new ConflictError('workshop_tier_required', {
        message: "A workshop needs at least one tier, so its last tier can't be removed.",
      })
    }

    const [booked] = await db
      .select({
        confirmed: sql<number>`count(*) filter (where ${bookings.state} = 'confirmed')`,
        past: sql<number>`count(*) filter (where ${bookings.state} <> 'confirmed')`,
      })
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.workshopTierId, tierId)))
    const n = Number(booked?.confirmed ?? 0)
    if (n > 0) {
      throw new ConflictError('workshop_tier_has_bookings', {
        bookings: n,
        message: `This tier has ${n} confirmed booking${n === 1 ? '' : 's'}, so it can't be removed.`,
      })
    }
    const past = Number(booked?.past ?? 0)
    if (past > 0) {
      throw new ConflictError('workshop_tier_has_booking_history', {
        bookings: past,
        message: `This tier has ${past} cancelled or no-show booking${past === 1 ? '' : 's'} on record, so it can't be removed.`,
      })
    }

    const { unpaid, partPaid } = await payableSalesOfWorkshopTier(tenantId, tierId)
    const unfinished = unpaid + partPaid
    if (unfinished > 0) {
      const clears =
        partPaid > 0
          ? 'A part-paid purchase holds it until it is paid in full or refunded.'
          : 'The hold clears within a day if the member does not pay.'
      throw new ConflictError('workshop_tier_has_open_purchases', {
        purchases: unfinished,
        message: `This tier has ${unfinished} unfinished purchase${unfinished === 1 ? '' : 's'} a member can still pay, so it can't be removed. ${clears}`,
      })
    }

    await db
      .delete(workshopTierDays)
      .where(and(eq(workshopTierDays.tenantId, tenantId), eq(workshopTierDays.workshopTierId, tierId)))
    await db
      .delete(workshopTiers)
      .where(and(eq(workshopTiers.tenantId, tenantId), eq(workshopTiers.id, tierId)))
  })
}
