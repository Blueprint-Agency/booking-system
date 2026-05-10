/**
 * Cancellation flow — both client and admin paths.
 * See be-client.md §4c (client) and be-portal.md §3b (admin).
 */
export type CancelSource = 'client' | 'admin'

export interface CancelInput {
  bookingId: string
  source: CancelSource
  actorStaffId?: string
}

export async function cancelBooking(_input: CancelInput): Promise<void> {
  throw new Error('not implemented')
}
