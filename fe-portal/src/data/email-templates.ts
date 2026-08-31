import type { EmailTemplate } from "@/types";

/**
 * Static fixture for the notifications screens. The enforcing allow-list is
 * `TEMPLATE_VARIABLES` in `be/src/services/notifications/variables.ts` — every
 * `variables` array below is copied from it by hand, and every `{{var}}` in a
 * subject or body is drawn only from that entry's array, because
 * `PATCH /portal/admin/notifications/templates/:slug` rejects anything else.
 * Reconcile against that file whenever it changes.
 */

const updatedAt = "2026-08-17T08:00:00.000Z";

export const emailTemplates: EmailTemplate[] = [
  // --- Auth ---
  {
    slug: "welcome",
    category: "Auth",
    label: "Welcome",
    description: "Sent when a customer completes registration.",
    trigger: "Customer completes registration",
    recipient: "New customer",
    variables: ["client_name"],
    subject: "Welcome, {{client_name}} 🙏",
    bodyHtml:
      "<p>Hello {{client_name}},</p><p>We're delighted to welcome you to the studio. Your account is ready — log in any time to browse our schedule and book your first class.</p><p>See you on the mat,<br/>The studio team</p>",
    updatedAt,
  },
  {
    slug: "password_reset",
    category: "Auth",
    label: "Password reset",
    description: "Sent when a customer requests a password reset.",
    trigger: "Customer requests password reset",
    recipient: "Customer",
    variables: ["client_name", "reset_url"],
    subject: "Reset your password",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Tap the link below to set a new password.</p><p><a href=\"{{reset_url}}\">Reset password</a></p>",
    updatedAt,
  },
  // --- Bookings ---
  {
    slug: "class_booking_confirmed",
    category: "Bookings",
    label: "Class booking confirmed",
    description: "Sent immediately when a customer books a class.",
    trigger: "Customer books a class",
    recipient: "Customer",
    variables: [
      "client_name",
      "class_name",
      "date",
      "instructor_name",
      "location",
      "qr_url",
      "code",
      "credits_remaining",
    ],
    subject: "Booked: {{class_name}} on {{date}}",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>You're confirmed for <strong>{{class_name}}</strong> with {{instructor_name}} on {{date}}, {{location}}.</p><p>Show this at the door — check-in code <strong>{{code}}</strong>.</p><p><img src=\"{{qr_url}}\" alt=\"Check-in QR code\" width=\"160\" height=\"160\" /></p><p>Credits remaining: {{credits_remaining}}.</p>",
    updatedAt,
  },
  {
    slug: "pt_request_submitted",
    category: "Bookings",
    label: "PT request submitted",
    description: "Confirms receipt of a private session request.",
    trigger: "Customer submits PT request (§9)",
    recipient: "Customer",
    variables: ["client_name", "instructor_name", "starts_at"],
    subject: "We received your request — {{instructor_name}}, {{starts_at}}",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your private session request with {{instructor_name}} on {{starts_at}} has been received. We'll confirm shortly.</p>",
    updatedAt,
  },
  {
    slug: "pt_session_approved",
    category: "Bookings",
    label: "PT session approved",
    description: "Sent when a PT request is approved.",
    trigger: "Admin/instructor approves PT request",
    recipient: "Customer",
    variables: ["client_name", "instructor_name", "starts_at", "location", "qr_url"],
    subject: "Confirmed: private session with {{instructor_name}}",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your private session with {{instructor_name}} is confirmed for {{starts_at}}, {{location}}. See you there.</p><p><img src=\"{{qr_url}}\" alt=\"Check-in QR code\" width=\"160\" height=\"160\" /></p>",
    updatedAt,
  },
  {
    slug: "pt_session_declined",
    category: "Bookings",
    label: "PT session declined",
    description: "Sent when a PT request is declined.",
    trigger: "Admin/instructor declines PT request",
    recipient: "Customer",
    variables: ["client_name", "instructor_name", "decline_note"],
    subject: "Update on your private session request",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Unfortunately we can't take your request with {{instructor_name}}.</p><p>{{decline_note}}</p>",
    updatedAt,
  },
  {
    slug: "pt_request_expired",
    category: "Bookings",
    label: "PT request expired",
    description: "Sent when a pending request goes unanswered past its expiry.",
    trigger: "Hourly pt-request-expiry job flips the request to `expired`",
    recipient: "Customer",
    variables: ["client_name", "instructor_name", "starts_at"],
    subject: "Your private session request expired",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your request to {{instructor_name}} for {{starts_at}} was not answered in time, so it has expired. Nothing was deducted.</p>",
    updatedAt,
  },
  {
    slug: "workshop_purchase_confirmed",
    category: "Bookings",
    label: "Workshop purchase confirmed",
    description: "Sent immediately after Stripe checkout for a workshop.",
    trigger: "Customer purchases a workshop tier",
    recipient: "Customer",
    variables: ["client_name", "workshop_name", "date", "qr_url", "code", "receipt_url"],
    subject: "Your spot at {{workshop_name}} is reserved",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>You're booked for <strong>{{workshop_name}}</strong> on {{date}}.</p><p>Show this at the door — check-in code <strong>{{code}}</strong>.</p><p><img src=\"{{qr_url}}\" alt=\"Check-in QR code\" width=\"160\" height=\"160\" /></p><p><a href=\"{{receipt_url}}\">View your receipt</a></p>",
    updatedAt,
  },
  // --- Client cancellations ---
  {
    slug: "class_cancelled_credit_returned",
    category: "Customer cancellations",
    label: "Class cancelled — credit returned",
    description: "Sent when a customer cancels a class within cap and within window.",
    trigger: "Customer cancels within cap + within window",
    recipient: "Customer",
    variables: ["client_name", "class_name", "date", "credits_returned"],
    subject: "Cancellation confirmed — {{credits_returned}} credit returned",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your booking for {{class_name}} on {{date}} has been cancelled. {{credits_returned}} credit has been returned to your package.</p>",
    updatedAt,
  },
  {
    slug: "class_cancelled_forfeited",
    category: "Customer cancellations",
    label: "Class cancelled — forfeited",
    description: "Sent when a customer cancels late or has hit the cap.",
    trigger: "Customer cancels late or over cap",
    recipient: "Customer",
    variables: ["client_name", "class_name", "date", "reason_line"],
    subject: "Cancellation noted — credit forfeited",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your booking for {{class_name}} on {{date}} has been cancelled.</p><p>{{reason_line}}</p>",
    updatedAt,
  },
  {
    slug: "pt_cancelled_session_returned",
    category: "Customer cancellations",
    label: "PT cancelled — session returned",
    description: "Sent when a customer cancels a PT session within cap and window.",
    trigger: "Customer cancels within cap + within window",
    recipient: "Customer",
    variables: ["client_name", "instructor_name", "starts_at"],
    subject: "Private session cancelled — session returned",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your private session with {{instructor_name}} on {{starts_at}} has been cancelled. The session has been returned to your PT package.</p>",
    updatedAt,
  },
  {
    slug: "pt_cancelled_forfeited",
    category: "Customer cancellations",
    label: "PT cancelled — forfeited",
    description: "Sent when a PT cancellation is too late or over cap.",
    trigger: "Customer cancels late or over cap",
    recipient: "Customer",
    variables: ["client_name", "instructor_name", "starts_at", "reason_line"],
    subject: "Private session cancelled — session forfeited",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your private session with {{instructor_name}} on {{starts_at}} has been cancelled.</p><p>{{reason_line}}</p>",
    updatedAt,
  },
  {
    slug: "workshop_waitlist_promoted",
    category: "Bookings",
    label: "Workshop waitlist promoted",
    description:
      "Offers a freed place to the next person on the waitlist. Deferred — no sender exists yet, so the row is here for editing only.",
    trigger: "A cancellation frees a place (not implemented in v1)",
    recipient: "Customer on the waitlist",
    variables: ["client_name", "workshop_name", "date", "claim_url", "claim_deadline"],
    subject: "You're off the waitlist — {{workshop_name}}",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>A place has come free in {{workshop_name}}, starting {{date}}, and it is offered to you first.</p><p>Confirm and pay by {{claim_deadline}} to take it — after that it goes to the next person on the waitlist.</p><p><a href=\"{{claim_url}}\">Confirm and pay</a></p>",
    updatedAt,
  },
  // --- Admin-initiated cancellations ---
  {
    slug: "admin_cancel_class",
    category: "Admin cancellations",
    label: "Class cancelled by admin",
    description: "Sent to all booked customers when admin cancels a class instance.",
    trigger: "Admin cancels a class instance (§7a)",
    recipient: "All booked customers",
    variables: ["client_name", "class_name", "date", "credits_returned"],
    subject: "Class cancelled — {{credits_returned}} credit returned",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>We've had to cancel {{class_name}} on {{date}}. Your {{credits_returned}} credit has been returned automatically.</p>",
    updatedAt,
  },
  {
    slug: "admin_cancel_pt",
    category: "Admin cancellations",
    label: "PT cancelled by admin",
    description: "Sent when admin or instructor cancels a private session.",
    trigger: "Admin/instructor cancels PT session (§7a)",
    recipient: "Customer",
    variables: ["client_name", "instructor_name", "starts_at"],
    subject: "Your private session has been cancelled",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your private session with {{instructor_name}} on {{starts_at}} has been cancelled. The session has been returned to your package.</p>",
    updatedAt,
  },
  {
    slug: "admin_cancel_workshop",
    category: "Admin cancellations",
    label: "Workshop cancelled by admin",
    description: "Sent to all attendees on workshop cancellation. Payment handling is reviewed by the studio.",
    trigger: "Admin cancels a workshop (§7a)",
    recipient: "All attendees",
    variables: ["client_name", "workshop_name", "refund_sgd"],
    subject: "Workshop cancelled",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>We've had to cancel {{workshop_name}}. You paid SGD {{refund_sgd}} for your place — the studio is arranging your refund and will contact you to settle it.</p>",
    updatedAt,
  },
  // --- Packages ---
  {
    slug: "package_purchase_confirmed",
    category: "Packages",
    label: "Package purchase confirmed",
    description:
      "Sent on successful Stripe charge for a package. {{contents_line}} and {{validity_line}} are whole composed sentences built per package kind — do not wrap them in copy that assumes credits or an expiry date.",
    trigger: "Customer purchases any package",
    recipient: "Customer",
    variables: ["client_name", "package_name", "contents_line", "validity_line", "receipt_url"],
    subject: "Receipt: {{package_name}}",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Thanks for your purchase of <strong>{{package_name}}</strong>.</p><p>{{contents_line}}</p><p>{{validity_line}}</p><p><a href=\"{{receipt_url}}\">View your receipt</a></p>",
    updatedAt,
  },
  {
    slug: "credit_expiry_reminder",
    category: "Packages",
    label: "Credit expiry reminder",
    description: "Sent 7 days before a package expires — a trial pass included, which is why what is left is a composed sentence and not a credit count.",
    trigger: "7 days before package expiry (hardcoded)",
    recipient: "Customer",
    variables: ["client_name", "package_name", "expires_at", "remaining_line"],
    subject: "Your {{package_name}} expires on {{expires_at}}",
    bodyHtml:
      "<p>Hi {{client_name}},</p><p>Your {{package_name}} expires on {{expires_at}} — {{remaining_line}} left. Book a class to use it up.</p>",
    updatedAt,
  },
  // --- Staff ---
  {
    slug: "instructor_invite",
    category: "Staff",
    label: "Instructor invite",
    description: "Auto-fired when an instructor profile is saved.",
    trigger: "Admin creates instructor profile (§15b)",
    recipient: "New instructor",
    variables: ["name", "invite_url", "expires_at"],
    subject: "You've been invited to teach at the studio",
    bodyHtml:
      "<p>Hi {{name}},</p><p>You've been added as an instructor. Set up your account using the link below — it expires on {{expires_at}}.</p><p><a href=\"{{invite_url}}\">Accept invitation</a></p>",
    updatedAt,
  },
  {
    slug: "admin_invite",
    category: "Staff",
    label: "Admin invite",
    description: "Magic-link invite sent to a new admin.",
    trigger: "Admin sends admin invite (§15b)",
    recipient: "Invitee",
    variables: ["name", "invite_url", "expires_at"],
    subject: "Admin access invitation",
    bodyHtml:
      "<p>Hi {{name}},</p><p>You've been invited to manage the studio. Tap the link to set up your account — it expires on {{expires_at}}.</p><p><a href=\"{{invite_url}}\">Accept invitation</a></p>",
    updatedAt,
  },
  {
    slug: "checkin_nag",
    category: "Staff",
    label: "Check-in nag",
    description: "Reminds the instructor to finalise check-in 24h after a session ends.",
    trigger: "Check-in still `pending` 24h after event end (§11)",
    recipient: "Assigned instructor (cc admin)",
    variables: ["instructor_name", "session_label", "pending_count"],
    subject: "{{pending_count}} attendees still need check-in finalised",
    bodyHtml:
      "<p>Hi {{instructor_name}},</p><p>{{pending_count}} attendees from {{session_label}} still need to be marked attended or no-show. Finalise check-in in the portal.</p>",
    updatedAt,
  },
];
