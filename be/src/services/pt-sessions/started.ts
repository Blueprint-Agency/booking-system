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

/**
 * The same rule for changing a 2on1 session to 1on1, which gives a session back
 * to a package as a cancel does (#499). It names the type change, so the portal
 * does not answer a refused change with its cancel wording.
 */
export function refuseTypeChangeOnceStarted(startsAt: Date, now: Date): void {
  if (now >= startsAt) {
    throw new AppError(422, 'session_already_started', {
      message: 'This session has already started, so its type can no longer change.',
    })
  }
}
