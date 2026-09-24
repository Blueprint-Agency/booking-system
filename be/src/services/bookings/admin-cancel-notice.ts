/**
 * What an admin's cancel of one booking will do, in the words the portal's
 * confirm dialog shows (#272). Composed here and not in the portal, because it
 * is `cancelBooking`'s rule restated: an admin cancel always returns what the
 * booking spent, and a booking that spent nothing — an Unlimited plan's — only
 * frees the place.
 *
 * Classes only. A private session is cancelled as a PT request, which also takes
 * its session off the calendar; a workshop is refunded, not cancelled
 * (`workshop_cancel_unsupported`).
 */
export interface AdminCancelInput {
  kind: 'class' | 'workshop' | 'pt'
  state: 'confirmed' | 'cancelled' | 'no_show'
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  creditsUsed: number | null
  packageName: string | null
  packageKind: string | null
}

/** Whether the portal offers "Cancel booking" on it. `cancelBooking` has the final say. */
export function adminCanCancel(b: AdminCancelInput): boolean {
  return b.kind === 'class' && b.state === 'confirmed' && b.checkInState !== 'attended'
}

/** The sentence the confirm dialog shows; null when there is no cancel to offer. */
export function adminCancelNotice(b: AdminCancelInput): string | null {
  if (!adminCanCancel(b)) return null
  const used = b.creditsUsed ?? 0
  if (used > 0) {
    const credits = used === 1 ? '1 credit goes' : `${used} credits go`
    return `${credits} back to ${b.packageName ?? 'the package that paid for it'}.`
  }
  if (b.packageKind === 'unlimited') {
    return 'Their plan is unlimited, so nothing goes back — the place is freed.'
  }
  return 'No credit was spent on it, so nothing goes back — the place is freed.'
}
