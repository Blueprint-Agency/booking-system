import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, type Api } from "./api";
import { EMAIL_NAMES, emailGroups, switchEmail, type StudioEmailsView } from "./emails";

const email = (slug: string, audience: "member" | "staff", locked: boolean, enabled = true) => ({
  slug,
  audience,
  locked,
  enabled,
});

const view = (): StudioEmailsView => ({
  member: [
    email("class_booking_confirmed", "member", false),
    email("sign_in_code", "member", true),
  ],
  staff: [
    email("checkin_nag", "staff", false, false),
    email("admin_invite", "staff", true),
  ],
});

test("NTF-46 the Emails page lists every email the API returns, To members then To staff, each by a name an admin can read", () => {
  assert.deepEqual(emailGroups(view()), [
    {
      audience: "member",
      title: "To members",
      emails: [
        { slug: "class_booking_confirmed", name: "Class booking confirmed", locked: false, enabled: true },
        { slug: "sign_in_code", name: "Sign-in code", locked: true, enabled: true },
      ],
    },
    {
      audience: "staff",
      title: "To staff",
      emails: [
        { slug: "checkin_nag", name: "Check-in reminder to instructor and admins", locked: false, enabled: false },
        { slug: "admin_invite", name: "Admin invitation", locked: true, enabled: true },
      ],
    },
  ]);
});

test("NTF-46 an email the portal has no name for yet is still listed, named from its slug", () => {
  const [members] = emailGroups({ member: [email("lesson_moved", "member", false)], staff: [] });
  assert.deepEqual(members.emails, [{ slug: "lesson_moved", name: "Lesson moved", locked: false, enabled: true }]);
});

test("NTF-46 every email the studio sends has a written name, not its slug", () => {
  const sent = [
    "class_booking_confirmed", "class_cancelled_credit_returned", "pt_cancelled_session_returned", "credit_expiry_reminder",
    "sign_in_code", "password_reset", "client_invite", "package_purchase_confirmed", "trial_pass_purchase_confirmed",
    "corporate_purchase_confirmed", "purchase_receipt", "workshop_purchase_confirmed", "purchase_refunded",
    "admin_cancel_class", "admin_cancel_pt", "admin_cancel_workshop", "class_rule_cancelled", "pt_request_cancelled",
    "class_waitlist_promoted", "checkin_nag", "instructor_cancel_class", "classpass_overbooked", "leave_request_submitted",
    "leave_approved", "leave_rejected", "leave_revoked", "staff_two_factor_code", "staff_password_reset", "admin_invite",
    "instructor_invite", "staff_email_change_link", "staff_email_changed_notice",
  ];
  for (const slug of sent) {
    const name = EMAIL_NAMES[slug];
    assert.ok(name, `${slug} has no name`);
    assert.ok(!name.includes("_"), `${slug} is named ${name}`);
  }
  assert.equal(new Set(sent.map((slug) => EMAIL_NAMES[slug])).size, sent.length, "two emails share a name");
});

test("NTF-47 flipping a switch shows it at once, saves it, and keeps what the API answered", async () => {
  let shown = view();
  const show = (update: (v: StudioEmailsView) => StudioEmailsView) => {
    shown = update(shown);
  };
  const calls: { path: string; body: unknown; shownWhileSaving: boolean }[] = [];
  const api = {
    patch: async (path: string, body: unknown) => {
      calls.push({ path, body, shownWhileSaving: shown.staff[0].enabled });
      return email("checkin_nag", "staff", false, true);
    },
  } as unknown as Api;

  assert.equal(await switchEmail(api, "checkin_nag", true, show), null);
  assert.deepEqual(calls, [{ path: "/portal/admin/emails/checkin_nag", body: { enabled: true }, shownWhileSaving: true }]);
  assert.equal(shown.staff[0].enabled, true);
  assert.deepEqual(shown.member, view().member, "the other emails are untouched");
});

test("NTF-47 a refused switch puts itself back and gives the API's sentence", async () => {
  let shown = view();
  const show = (update: (v: StudioEmailsView) => StudioEmailsView) => {
    shown = update(shown);
  };
  const refused = {
    patch: async () => {
      throw new ApiError(409, { error: "email_locked", message: "This email is always sent, so it cannot be switched off." });
    },
  } as unknown as Api;

  assert.equal(
    await switchEmail(refused, "class_booking_confirmed", false, show),
    "This email is always sent, so it cannot be switched off.",
  );
  assert.deepEqual(shown, view());

  const offline = {
    patch: async () => {
      throw new TypeError("Failed to fetch");
    },
  } as unknown as Api;
  assert.equal(await switchEmail(offline, "checkin_nag", true, show), "Couldn’t save the switch. Try again.");
  assert.deepEqual(shown, view());
});
