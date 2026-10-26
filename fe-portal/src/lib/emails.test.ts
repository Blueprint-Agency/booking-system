import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, type Api } from "./api";
import { emailGroups, switchEmail, type StudioEmailsView } from "./emails";

const email = (slug: string, name: string, audience: "member" | "staff", locked: boolean, enabled = true) => ({
  slug,
  name,
  audience,
  locked,
  enabled,
});

const view = (): StudioEmailsView => ({
  member: [
    email("lesson_moved", "A lesson moved to a new time", "member", false),
    email("door_code", "Front door code", "member", true),
  ],
  staff: [
    email("rota_ready", "Next week's rota is ready", "staff", false, false),
    email("key_handover", "Key handover", "staff", true),
  ],
});

test("NTF-46 the Emails page lists every email the API returns, To members then To staff, each by the name the API gives it", () => {
  assert.deepEqual(emailGroups(view()), [
    {
      audience: "member",
      title: "To members",
      emails: [
        { slug: "lesson_moved", name: "A lesson moved to a new time", locked: false, enabled: true },
        { slug: "door_code", name: "Front door code", locked: true, enabled: true },
      ],
    },
    {
      audience: "staff",
      title: "To staff",
      emails: [
        { slug: "rota_ready", name: "Next week's rota is ready", locked: false, enabled: false },
        { slug: "key_handover", name: "Key handover", locked: true, enabled: true },
      ],
    },
  ]);
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
      return email("rota_ready", "Next week's rota is ready", "staff", false, true);
    },
  } as unknown as Api;

  assert.equal(await switchEmail(api, "rota_ready", true, show), null);
  assert.deepEqual(calls, [{ path: "/portal/admin/emails/rota_ready", body: { enabled: true }, shownWhileSaving: true }]);
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
    await switchEmail(refused, "lesson_moved", false, show),
    "This email is always sent, so it cannot be switched off.",
  );
  assert.deepEqual(shown, view());

  const offline = {
    patch: async () => {
      throw new TypeError("Failed to fetch");
    },
  } as unknown as Api;
  assert.equal(await switchEmail(offline, "rota_ready", true, show), "Couldn’t save the switch. Try again.");
  assert.deepEqual(shown, view());
});
