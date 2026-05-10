/**
 * Validate + insert workshop with tiers + images + instructors in a transaction.
 * Called from POST /portal/admin/schedule/workshops.
 */
export interface PublishWorkshopInput {
  name: string
  classTypeId: string
  locationId: string
  startsAt: Date
  endsAt: Date
  descriptionHtml?: string
  coverR2Key?: string
  imageR2Keys?: string[]
  instructorIds: string[]
  tiers: Array<{
    name: string
    description?: string
    regularPriceSgd: string
    earlyBirdPriceSgd?: string
    earlyBirdQuota?: number
    earlyBirdCutoffAt?: Date
    capacity: number
    ord: number
  }>
  createdByStaffId: string
}

export async function publishWorkshop(_input: PublishWorkshopInput): Promise<{ workshopId: string }> {
  throw new Error('not implemented')
}
