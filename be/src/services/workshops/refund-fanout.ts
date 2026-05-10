/**
 * Workshop admin-cancel → enqueue stripe-refund job per booking.
 * v1: synchronous Stripe Refund API call inline. Future: BullMQ.
 * See be-portal.md §3b.
 */
export async function cancelWorkshop(_workshopId: string, _actorStaffId: string): Promise<void> {
  throw new Error('not implemented')
}
