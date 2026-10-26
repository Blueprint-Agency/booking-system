import { AppError } from '../../shared/errors'

/**
 * Staff give a private session back only before it starts (pt-session-lifecycle
 * §3.2, #241, #434): one that has begun is being held, and one that ended
 * unticked was held or no-showed, so its sessions were used and its instructor
 * is owed the pay.
 */
export function refuseOnceStarted(startsAt: Date, now: Date): void {
  if (now >= startsAt) throw new AppError(422, 'session_already_started')
}
