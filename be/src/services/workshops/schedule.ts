import { db } from '../../db'
import { BadRequestError } from '../../shared/errors'
import { recordSessionAssigned } from '../attention/session-assigned'
import { lockOccupancy } from '../schedule/occupancy'
import { replacePromotionsForParent, type PromotionWriteInput } from '../packages/promotions'
import {
  createWorkshop,
  getWorkshop,
  updateWorkshop,
  type CreateWorkshopInput,
  type UpdateWorkshopInput,
  type WorkshopRow,
} from './publish'
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

export interface WorkshopScheduleInput {
  days: ScheduleDayInput[]
  tiers: ScheduleTierInput[]
}

/**
 * The editor's one save of an existing workshop (#502): its basics and roster,
 * days, tiers and, when sent, promotions, together or not at all. The
 * counterpart of `createWorkshopWithSchedule`, and like it one savepoint of its
 * own: the request's transaction commits even when the answer is a 4xx, so the
 * savepoint is what takes back the parts already written, the Updates among
 * them.
 *
 * Without `schedule` and `promotions` it is `updateWorkshop` under the workshop
 * row's lock; the route keeps a basics-only save off this path.
 */
export async function updateWorkshopWithSchedule(
  tenantId: string,
  workshopId: string,
  input: {
    basics: UpdateWorkshopInput
    schedule?: WorkshopScheduleInput
    /** Undefined leaves the promotions as they are; an empty list archives them all. */
    promotions?: PromotionWriteInput[]
    actorStaffId: string
  },
): Promise<WorkshopRow> {
  const { basics, schedule, promotions, actorStaffId } = input
  return db.transaction(async tx => {
    const existing = await getWorkshop(tenantId, workshopId, { lock: true })
    if (existing.lifecycle === 'cancelled') throw new BadRequestError('workshop_cancelled')
    if (schedule) await claimDayRooms(tx, tenantId, schedule.days)
    // The basics come first, so a day's room is checked against the location this save sets.
    const row = await updateWorkshop(tenantId, workshopId, { ...basics, actorStaffId })
    if (schedule) await writeSchedule(tenantId, workshopId, schedule, actorStaffId)
    if (promotions) await replacePromotionsForParent(tenantId, 'workshop', workshopId, promotions, actorStaffId)
    return row
  })
}

export async function saveWorkshopSchedule(
  tenantId: string,
  workshopId: string,
  input: WorkshopScheduleInput,
  /** Who made the edit: the instructors are told of a moved day by anyone else. */
  actorStaffId?: string,
): Promise<{ days: WorkshopDayRow[]; tiers: TierWithDays[] }> {
  return db.transaction(async tx => {
    await getWorkshop(tenantId, workshopId, { lock: true })
    await claimDayRooms(tx, tenantId, input.days)
    return writeSchedule(tenantId, workshopId, input, actorStaffId)
  })
}

/**
 * Each day claims its own room as it is written. Claimed one by one, two saves
 * naming the same rooms in opposite order would each hold the room the other
 * waits for, so every room is claimed at once, in lock-id order, first.
 */
async function claimDayRooms(tx: Parameters<typeof lockOccupancy>[0], tenantId: string, days: ScheduleDayInput[]) {
  await lockOccupancy(
    tx,
    tenantId,
    days.map(d => ({ kind: 'room', id: d.roomId })),
  )
}

/** The day-and-tier rules, once, for the schedule-only save and the one save. Runs under the workshop row's lock. */
async function writeSchedule(
  tenantId: string,
  workshopId: string,
  input: WorkshopScheduleInput,
  actorStaffId?: string,
): Promise<{ days: WorkshopDayRow[]; tiers: TierWithDays[] }> {
  const storedTiers = await listTiers(tenantId, workshopId)

  const keptDays = new Set(input.days.map(d => d.id))
  for (const day of await listDays(tenantId, workshopId)) {
    if (!keptDays.has(day.id)) await deleteDay(tenantId, workshopId, day.id)
  }

  const dayIdByRef = new Map<string, string>()
  for (const [i, { id, ref, ...day }] of input.days.entries()) {
    const saved = id
      ? await updateDay(tenantId, workshopId, id, { ...day, ord: i + 1 }, actorStaffId)
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
}
