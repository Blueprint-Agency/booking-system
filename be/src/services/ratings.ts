/** Insert + edit + view-scoped read of ratings. */
export interface SubmitRatingInput {
  bookingId: string
  clientId: string
  stars: number
  comment?: string
}

export async function submitRating(_input: SubmitRatingInput): Promise<void> {
  throw new Error('not implemented')
}

export async function editRating(_bookingId: string, _input: Pick<SubmitRatingInput, 'stars' | 'comment'>): Promise<void> {
  throw new Error('not implemented')
}
