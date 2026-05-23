import { db } from '../../db'
import { classes } from '../../db/schema'
import { assertRoomAvailable, assertRoomInLocation } from './room-conflicts'

export interface CreateClassInput {
  classTypeId: string
  instructorId: string
  locationId: string
  roomId: string
  startsAt: Date
  endsAt: Date
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  creditCost: number
  createdByStaffId: string
}

export type ClassRow = typeof classes.$inferSelect

export async function createClass(input: CreateClassInput): Promise<ClassRow> {
  await assertRoomInLocation(input.roomId, input.locationId)
  await assertRoomAvailable(input.roomId, input.startsAt, input.endsAt)
  const rows = await db
    .insert(classes)
    .values({
      classTypeId: input.classTypeId,
      mainInstructorId: input.instructorId,
      locationId: input.locationId,
      roomId: input.roomId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacityOnline: input.capacityOnline,
      capacityWaitlist: input.capacityWaitlist,
      capacityBuffer: input.capacityBuffer,
      creditCost: input.creditCost,
      createdByStaffId: input.createdByStaffId,
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error('insert returned no rows')
  return row
}
