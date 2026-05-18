import { db } from '../../db'
import { classes } from '../../db/schema'

export interface CreateClassInput {
  classTypeId: string
  instructorId: string
  locationId: string
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
  const rows = await db
    .insert(classes)
    .values({
      classTypeId: input.classTypeId,
      instructorId: input.instructorId,
      locationId: input.locationId,
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
