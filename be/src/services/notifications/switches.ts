/**
 * Every email the platform sends on a studio's behalf, and whether the studio
 * may switch it off.
 *
 * `name` is how the portal's Emails page lists it. `audience` is who receives
 * it: a member, or the studio's staff. `locked` is an email the studio cannot
 * stop: sign-in and account mail, money, and anything staff or the system did
 * to a member's booking. A locked email never reads the studio's switch,
 * whatever it holds.
 *
 * The send path accepts only these slugs (`services/notifications/send.ts`),
 * so a sender cannot pass an email nobody has classified.
 */
export type EmailAudience = 'member' | 'staff'

export const STUDIO_EMAILS = {
  class_booking_confirmed: { name: 'Class booking confirmed', audience: 'member', locked: false },
  class_cancelled_credit_returned: { name: 'Member cancelled a class, credit returned', audience: 'member', locked: false },
  pt_cancelled_session_returned: { name: 'Member cancelled a private session, session returned', audience: 'member', locked: false },
  credit_expiry_reminder: { name: 'Package about to expire', audience: 'member', locked: false },
  sign_in_code: { name: 'Sign-in code', audience: 'member', locked: true },
  password_reset: { name: 'Password reset', audience: 'member', locked: true },
  client_invite: { name: 'Member invitation', audience: 'member', locked: true },
  package_purchase_confirmed: { name: 'Package purchase confirmed', audience: 'member', locked: true },
  trial_pass_purchase_confirmed: { name: 'Trial pass purchase confirmed', audience: 'member', locked: true },
  corporate_purchase_confirmed: { name: 'Corporate package purchase confirmed', audience: 'member', locked: true },
  purchase_receipt: { name: 'Receipt', audience: 'member', locked: true },
  workshop_purchase_confirmed: { name: 'Workshop purchase confirmed', audience: 'member', locked: true },
  purchase_refunded: { name: 'Purchase refunded', audience: 'member', locked: true },
  admin_cancel_class: { name: 'Studio cancelled a class', audience: 'member', locked: true },
  admin_cancel_pt: { name: 'Studio cancelled a private session', audience: 'member', locked: true },
  admin_cancel_workshop: { name: 'Studio cancelled a workshop', audience: 'member', locked: true },
  class_rule_cancelled: { name: "Booking cancelled by a change to a class's accepted packages", audience: 'member', locked: true },
  // One slug for a member's cancel and a staff cancel, so locked whole.
  pt_request_cancelled: { name: 'Private session request cancelled', audience: 'member', locked: true },
  class_waitlist_promoted: { name: 'Booked off the waitlist', audience: 'member', locked: true },
  // To the instructor and every admin: one switch covers both.
  checkin_nag: { name: 'Check-in reminder to instructor and admins', audience: 'staff', locked: false },
  instructor_cancel_class: { name: 'Instructor cancelled a class, to admins', audience: 'staff', locked: false },
  classpass_overbooked: { name: 'ClassPass booking overbooked a class, to admins', audience: 'staff', locked: false },
  leave_request_submitted: { name: 'Leave requested, to admins', audience: 'staff', locked: false },
  leave_approved: { name: 'Leave approved, to the staff member', audience: 'staff', locked: false },
  leave_rejected: { name: 'Leave rejected, to the staff member', audience: 'staff', locked: false },
  leave_revoked: { name: 'Approved leave revoked, to the staff member', audience: 'staff', locked: false },
  staff_two_factor_code: { name: 'Portal verification code', audience: 'staff', locked: true },
  staff_password_reset: { name: 'Portal password reset', audience: 'staff', locked: true },
  admin_invite: { name: 'Admin invitation', audience: 'staff', locked: true },
  instructor_invite: { name: 'Instructor invitation', audience: 'staff', locked: true },
  staff_email_change_link: { name: 'Confirm a new sign-in email', audience: 'staff', locked: true },
  staff_email_changed_notice: { name: 'Sign-in email changed notice', audience: 'staff', locked: true },
} as const satisfies Record<string, { name: string; audience: EmailAudience; locked: boolean }>

export type StudioEmailSlug = keyof typeof STUDIO_EMAILS

export function isStudioEmailSlug(slug: string): slug is StudioEmailSlug {
  return Object.hasOwn(STUDIO_EMAILS, slug)
}
