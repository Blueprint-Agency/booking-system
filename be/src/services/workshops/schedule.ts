import { db } from '../../db'
import { BadRequestError } from '../../shared/errors'
import { recordSessionAssigned } from '../attention/session-assigned'
import { lockOccupancy } from '../schedule/occupancy'
import { replacePromotionsForParent, type PromotionWriteInput } from '../packages/promotions'
import { createWorkshop, getWorkshop, type CreateWorkshopInput, type WorkshopRow } from './publish'
import { createDay, deleteDay, listDays, updateDay, type CreateDayInput, type WorkshopDayRow } from './days'
import { createTier, deleteTier, listTiers, updateTier, type CreateTierInput, type TierWithDays } from './tiers'

export interface ScheduleDayInput extends Omit<CreateDayInput, 'ord' | 'basePriceSgd'> {
  id?: string
  ref: string
}

export interface ScheduleTierInput extends Omit<CreateTierInput, 'ord' | 'dayIds'> {
  id?: string
  dayRefs: string[]
}

export async function createWorkshopWithSchedule(
  tenantId: string,
  input: CreateWorkshopInput & {
    days: ScheduleDayInput[]
    tiers: ScheduleTierInput[]
    promotions: PromotionWriteInput[]
  },
): Promise<WorkshopRow> {
  const { days, tiers, promotions, ...basics } = input
  return db.transaction(async () => {
    const row = await createWorkshop(tenantId, basics)
    if (days.length || tiers.length) await saveWorkshopSchedule(tenantId, row.id, { days, tiers })
    // Told last, so the update can name the workshop's first day.
    await recordSessionAssigned(
      tenantId,
      basics.createdByStaffId,
      { kind: 'workshop', id: row.id },
      {
        main: [basics.mainInstructorId],
        supporting: (basics.supportingInstructors ?? []).map(s => s.instructorId),
      },
    )
    if (promotions.length) {
      await replacePromotionsForParent(tenantId, 'workshop', row.id, promotions, basics.createdByStaffId)
    }
    return row
  })
}

export async function saveWorkshopSchedule(
  tenantId: string,
  workshopId: string,
  input: { days: ScheduleDayInput[]; tiers: ScheduleTierInput[] },
): Promise<{ days: WorkshopDayRow[]; tiers: TierWithDays[] }> {
  return db.transaction(async tx => {
    await getWorkshop(tenantId, workshopId, { lock: true })
    // Each day claims its own room below. Claimed one by one, two saves naming
    // the same rooms in opposite order would each hold the room the other
    // waits for.
    await lockOccupancy(
      tx,
      tenantId,
      input.days.map(d => ({ kind: 'room', id: d.roomId })),
    )
    const storedTiers = await listTiers(tenantId, workshopId)

    const keptDays = new Set(input.days.map(d => d.id))
    for (const day of await listDays(tenantId, workshopId)) {
      if (!keptDays.has(day.id)) await deleteDay(tenantId, workshopId, day.id)
    }

    const dayIdByRef = new Map<string, string>()
    for (const [i, { id, ref, ...day }] of input.days.entries()) {
      const saved = id
        ? await updateDay(tenantId, workshopId, id, { ...day, ord: i + 1 })
        : await createDay(tenantId, workshopId, { ...day, ord: i + 1, basePriceSgd: '0.00' })
      dayIdByRef.set(ref, saved.id)
    }

    for (const [i, { id, dayRefs, ...tier }] of input.tiers.entries()) {
      const unknown = dayRefs.filter(ref => !dayIdByRef.has(ref))
      if (unknown.length) throw new BadRequestError('invalid_workshop_day_ids', { invalid: unknown })
      const fields = { ...tier, ord: i + 1, dayIds: dayRefs.map(ref => dayIdByRef.get(ref)!) }
      if (id) await updateTier(tenantId, workshopId, id, fields)
      else await createTier(tenantId, workshopId, fields)
    }

    const keptTiers = new Set(input.tiers.map(t => t.id))
    for (const tier of storedTiers) {
      if (!keptTiers.has(tier.id)) await deleteTier(tenantId, workshopId, tier.id)
    }

    return { days: await listDays(tenantId, workshopId), tiers: await listTiers(tenantId, workshopId) }
  })
}
