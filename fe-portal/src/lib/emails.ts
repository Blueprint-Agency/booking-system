import type { Api } from "./api";
import { refusalMessage } from "./refusal-message";

/**
 * The studio's emails and their switches (be-portal.md § emails.ts). The
 * backend's list is the whole truth: the page shows what it returns, and only
 * names each email here.
 */
export type EmailAudience = "member" | "staff";

export interface StudioEmail {
  slug: string;
  audience: EmailAudience;
  /** Always sent: listed, never switchable. */
  locked: boolean;
  enabled: boolean;
}

export type StudioEmailsView = Record<EmailAudience, StudioEmail[]>;

export const EMAIL_NAMES: Record<string, string> = {
  class_booking_confirmed: "Class booking confirmed",
  class_cancelled_credit_returned: "Member cancelled a class, credit returned",
  pt_cancelled_session_returned: "Member cancelled a private session, session returned",
  credit_expiry_reminder: "Package about to expire",
  sign_in_code: "Sign-in code",
  password_reset: "Password reset",
  client_invite: "Member invitation",
  package_purchase_confirmed: "Package purchase confirmed",
  trial_pass_purchase_confirmed: "Trial pass purchase confirmed",
  corporate_purchase_confirmed: "Corporate package purchase confirmed",
  purchase_receipt: "Receipt",
  workshop_purchase_confirmed: "Workshop purchase confirmed",
  purchase_refunded: "Purchase refunded",
  admin_cancel_class: "Studio cancelled a class",
  admin_cancel_pt: "Studio cancelled a private session",
  admin_cancel_workshop: "Studio cancelled a workshop",
  class_rule_cancelled: "Booking cancelled by a change to a class's accepted packages",
  pt_request_cancelled: "Private session request cancelled",
  class_waitlist_promoted: "Booked off the waitlist",
  checkin_nag: "Check-in reminder to instructor and admins",
  instructor_cancel_class: "Instructor cancelled a class, to admins",
  classpass_overbooked: "ClassPass booking overbooked a class, to admins",
  leave_request_submitted: "Leave requested, to admins",
  leave_approved: "Leave approved, to the staff member",
  leave_rejected: "Leave rejected, to the staff member",
  leave_revoked: "Approved leave revoked, to the staff member",
  staff_two_factor_code: "Portal verification code",
  staff_password_reset: "Portal password reset",
  admin_invite: "Admin invitation",
  instructor_invite: "Instructor invitation",
  staff_email_change_link: "Confirm a new sign-in email",
  staff_email_changed_notice: "Sign-in email changed notice",
};

const nameOf = (slug: string) => {
  const words = slug.replace(/_/g, " ");
  return EMAIL_NAMES[slug] ?? words.charAt(0).toUpperCase() + words.slice(1);
};

const GROUPS: { audience: EmailAudience; title: string }[] = [
  { audience: "member", title: "To members" },
  { audience: "staff", title: "To staff" },
];

export interface EmailGroup {
  audience: EmailAudience;
  title: string;
  emails: { slug: string; name: string; locked: boolean; enabled: boolean }[];
}

/** The page's two lists, in the order the API gave each one. */
export function emailGroups(view: StudioEmailsView): EmailGroup[] {
  return GROUPS.map(({ audience, title }) => ({
    audience,
    title,
    emails: view[audience].map(({ slug, locked, enabled }) => ({ slug, name: nameOf(slug), locked, enabled })),
  }));
}

const PATH = "/portal/admin/emails";

export const fetchStudioEmails = (api: Api) => api.get<StudioEmailsView>(PATH);

const withEnabled = (view: StudioEmailsView, slug: string, enabled: boolean): StudioEmailsView => ({
  member: view.member.map((e) => (e.slug === slug ? { ...e, enabled } : e)),
  staff: view.staff.map((e) => (e.slug === slug ? { ...e, enabled } : e)),
});

/**
 * Switch one email, showing the change before the API answers. A refusal
 * puts the switch back and returns the sentence to show; success returns null.
 * `show` takes an update, so two switches saving at once each put back only
 * their own.
 */
export async function switchEmail(
  api: Api,
  slug: string,
  enabled: boolean,
  show: (update: (view: StudioEmailsView) => StudioEmailsView) => void,
): Promise<string | null> {
  show((view) => withEnabled(view, slug, enabled));
  try {
    const saved = await api.patch<StudioEmail>(`${PATH}/${encodeURIComponent(slug)}`, { enabled });
    show((view) => withEnabled(view, slug, saved.enabled));
    return null;
  } catch (err) {
    show((view) => withEnabled(view, slug, !enabled));
    return refusalMessage(err, "Couldn’t save the switch. Try again.");
  }
}
