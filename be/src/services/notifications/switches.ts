/**
 * Every email the platform sends on a studio's behalf, and whether the studio
 * may switch it off.
 *
 * `audience` is who receives it: a member, or the studio's staff. `locked` is
 * an email the studio cannot stop: sign-in and account mail, money, and
 * anything staff or the system did to a member's booking. A locked email never
 * reads the studio's switch, whatever it holds.
 *
 * The send path accepts only these slugs (`services/notifications/send.ts`),
 * so a sender cannot pass an email nobody has classified.
 */
export type EmailAudience = 'member' | 'staff'

export const STUDIO_EMAILS = {
  class_booking_confirmed: { audience: 'member', locked: false },
  class_cancelled_credit_returned: { audience: 'member', locked: false },
  pt_cancelled_session_returned: { audience: 'member', locked: false },
  credit_expiry_reminder: { audience: 'member', locked: false },
  sign_in_code: { audience: 'member', locked: true },
  password_reset: { audience: 'member', locked: true },
  client_invite: { audience: 'member', locked: true },
  package_purchase_confirmed: { audience: 'member', locked: true },
  trial_pass_purchase_confirmed: { audience: 'member', locked: true },
  corporate_purchase_confirmed: { audience: 'member', locked: true },
  purchase_receipt: { audience: 'member', locked: true },
  workshop_purchase_confirmed: { audience: 'member', locked: true },
  purchase_refunded: { audience: 'member', locked: true },
  admin_cancel_class: { audience: 'member', locked: true },
  admin_cancel_pt: { audience: 'member', locked: true },
  admin_cancel_workshop: { audience: 'member', locked: true },
  class_rule_cancelled: { audience: 'member', locked: true },
  // One slug for a member's cancel and a staff cancel, so locked whole.
  pt_request_cancelled: { audience: 'member', locked: true },
  class_waitlist_promoted: { audience: 'member', locked: true },
  // To the instructor and every admin: one switch covers both.
  checkin_nag: { audience: 'staff', locked: false },
  instructor_cancel_class: { audience: 'staff', locked: false },
  classpass_overbooked: { audience: 'staff', locked: false },
  leave_request_submitted: { audience: 'staff', locked: false },
  leave_approved: { audience: 'staff', locked: false },
  leave_rejected: { audience: 'staff', locked: false },
  leave_revoked: { audience: 'staff', locked: false },
  staff_two_factor_code: { audience: 'staff', locked: true },
  staff_password_reset: { audience: 'staff', locked: true },
  admin_invite: { audience: 'staff', locked: true },
  instructor_invite: { audience: 'staff', locked: true },
  staff_email_change_link: { audience: 'staff', locked: true },
  staff_email_changed_notice: { audience: 'staff', locked: true },
} as const satisfies Record<string, { audience: EmailAudience; locked: boolean }>

export type StudioEmailSlug = keyof typeof STUDIO_EMAILS

export function isStudioEmailSlug(slug: string): slug is StudioEmailSlug {
  return Object.hasOwn(STUDIO_EMAILS, slug)
}
