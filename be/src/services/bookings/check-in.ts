/**
 * No-show flip: bookings where session.ends_at < now AND check_in_state='pending'
 * → set check_in_state='no_show' and apply forfeit logic.
 * Replaces the old attendance.service.ts:flipNoShows.
 */
export async function flipNoShows(): Promise<void> {
  // TODO: SELECT bookings JOIN session WHERE session.ends_at < now AND check_in_state='pending'
  //       UPDATE check_in_state='no_show', state='no_show', refund_outcome='forfeited'
}
