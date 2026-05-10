/**
 * Class booking: capacity check + credit deduct in transaction.
 * See be-client.md §4a.
 */
export interface BookClassInput {
  clientId: string
  classId: string
  clientPackageId: string
}

export async function bookClass(_input: BookClassInput): Promise<{ bookingId: string; qrToken: string; code: string }> {
  throw new Error('not implemented')
}
