import { AppError } from '../../shared/errors'

/**
 * Staff give a private session back only before it starts (pt-session-lifecycle
 * §3.2, #241, #434). One that has begun is being held, and one that has ended
 * unticked was held or no-showed: either way its sessions were used. So every
 * staff route that cancels a session or a seat on it — the request's cancel,
 * the booking cancel, removing a member — refuses from `starts_at` on.
 */
export function refuseOnceStarted(startsAt: Date, now: Date): void {
  if (now >= startsAt) throw new AppError(422, 'session_already_started')
}
