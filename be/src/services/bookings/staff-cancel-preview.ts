/**
 * What the portal's cancel-booking dialog needs to ask a staff member "Return
 * the credit or keep it?" (#320), carried on the roster rows and the admin
 * member-booking view so the dialog needs no request of its own.
 *
 * Only facts, no decision: a staff cancel returns or keeps what the booking
 * spent as the staff member chooses (`cancelBooking`), so the preview says what
 * was spent, from which package, whether the plan is Unlimited (nothing to
 * choose) and whether the class is already inside its Cancellation Window.
 *
 * Classes only. A private session is cancelled as a PT request, which also takes
 * its session off the calendar; a workshop is refunded, not cancelled
 * (`workshop_cancel_unsupported`).
 */
import { insideCancelWindow } from '../policy/cancel-window'

export interface StaffCancelInput {
  kind: 'class' | 'workshop' | 'pt'
  state: 'confirmed' | 'cancelled' | 'no_show'
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  creditsUsed: number | null
  packageName: string | null
  packageKind: string | null
  startsAt: Date | null
}

export interface StaffCancelPreview {
  /**
   * Credits the booking spent — 0 on an Unlimited plan. A package Voided by a
   * Refund cancels its bookings as it goes, so no bookable row still points at one.
   */
  credits: number
  /** The package that paid, by name; a Return credit goes back to it. */
  packageName: string | null
  unlimited: boolean
  /** Inside the class's effective Cancellation Window (or started). */
  late: boolean
}

/** Whether the portal offers "Cancel booking" on it. `cancelBooking` has the final say. */
export function staffCanCancel(b: StaffCancelInput): boolean {
  return b.kind === 'class' && b.state === 'confirmed' && b.checkInState !== 'attended'
}

/**
 * The dialog's facts; null when there is no cancel to offer. `windowHours` is
 * the class's effective window (`cancelWindowResolver`).
 */
export function staffCancelPreview(b: StaffCancelInput, windowHours: number, now: Date): StaffCancelPreview | null {
  if (!staffCanCancel(b)) return null
  return {
    credits: b.creditsUsed ?? 0,
    packageName: b.packageName,
    unlimited: b.packageKind === 'unlimited',
    late: b.startsAt !== null && insideCancelWindow(b.startsAt, windowHours, now),
  }
}

/** The wire shape, shared by the roster and the member-booking view. */
export function staffCancelPreviewJson(p: StaffCancelPreview | null) {
  return p && { credits: p.credits, package_name: p.packageName, unlimited: p.unlimited, late: p.late }
}
