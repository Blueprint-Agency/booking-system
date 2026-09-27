import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import {
  addMemberBody,
  canAddMember,
  downgradeConfirm,
  downgradeLeaving,
  isManual,
  ptCancelConfirm,
  retypeBody,
  sessionActionErrorMessage,
  manualSessionBody,
  manualSessionErrorMessage,
  seatChoice,
  seatLimit,
  seatWarnings,
  type ManualSeat,
  type SeatCandidate,
} from "./pt-manual";

const cand = (over: Partial<SeatCandidate>): SeatCandidate => ({
  id: "p",
  name: "10 Private Sessions",
  session_type: "1on1",
  sessions_left: 4,
  expires_at: "2031-05-01T00:00:00.000Z",
  bound_instructor: null,
  eligible: true,
  reason: null,
  warnings: [],
  activation_end_if_picked: null,
  ...over,
});

/* ── which package pays a seat ── */

test("PT-105 one Eligible package is pre-selected with no select; none says why the member can't be added", () => {
  const one = seatChoice({
    default_client_package_id: "a",
    packages: [cand({ id: "a" }), cand({ id: "b", eligible: false, reason: "insufficient_pt_credit" })],
  });
  assert.strictEqual(one.choosable, false);
  assert.strictEqual(one.defaultId, "a");
  assert.strictEqual(one.refusal, null);

  const none = seatChoice({
    default_client_package_id: null,
    packages: [cand({ id: "b", eligible: false, reason: "package_expired" })],
  });
  assert.strictEqual(none.defaultId, null);
  assert.strictEqual(none.refusal, "This member has no PT package that can pay for this session.");

  const empty = seatChoice({ default_client_package_id: null, packages: [] });
  assert.strictEqual(empty.refusal, "This member holds no PT package.");
});

test("PT-105 more than one Eligible package offers a select naming each, Ineligible ones greyed with their reason", () => {
  const choice = seatChoice({
    default_client_package_id: "run",
    packages: [
      cand({ id: "run" }),
      cand({
        id: "dorm",
        name: "5 Duo Sessions",
        session_type: "2on1",
        sessions_left: 5,
        expires_at: null,
        bound_instructor: { id: "i2", name: "Robin" },
        activation_end_if_picked: "2031-08-10T04:00:00.000Z",
        warnings: ["session_type_mismatch"],
      }),
      cand({ id: "empty", sessions_left: 0, eligible: false, reason: "insufficient_pt_credit" }),
      cand({ id: "theirs", eligible: false, reason: "bound_to_other_instructor", bound_instructor: { id: "i2", name: "Robin" } }),
    ],
  });
  assert.strictEqual(choice.choosable, true);
  assert.strictEqual(choice.defaultId, "run");
  assert.deepStrictEqual(
    choice.options.map((o) => [o.id, o.label, o.disabled, o.note]),
    [
      ["run", "10 Private Sessions · 4 sessions left · 1-on-1 · ends 1 May 2031", false, null],
      [
        "dorm",
        "5 Duo Sessions · 5 sessions left · 2-on-1 · bound to Robin",
        false,
        "Starts today, runs until 10 Aug 2031",
      ],
      ["empty", "10 Private Sessions · 0 sessions left · 1-on-1 · ends 1 May 2031", true, "No sessions left"],
      [
        "theirs",
        "10 Private Sessions · 4 sessions left · 1-on-1 · bound to Robin · ends 1 May 2031",
        true,
        "Bound to another instructor",
      ],
    ],
  );
});

test("PT-105 a 1on1 seats one member and a 2on1 two", () => {
  assert.strictEqual(seatLimit("1on1"), 1);
  assert.strictEqual(seatLimit("2on1"), 2);
});

/* ── the warnings staff may accept ── */

test("PT-106 the chosen package's warnings are worded for the session they are about", () => {
  const p = cand({
    session_type: "2on1",
    bound_instructor: { id: "i2", name: "Robin" },
    warnings: ["session_type_mismatch", "bound_to_other_instructor"],
  });
  assert.deepStrictEqual(seatWarnings(p, "1on1"), [
    "This is a 2-on-1 package on a 1-on-1 session.",
    "This package is bound to Robin.",
  ]);
  assert.deepStrictEqual(seatWarnings(cand({}), "1on1"), []);
});

/* ── saving ── */

const seat = (over: Partial<ManualSeat>): ManualSeat => ({
  clientId: "c1",
  name: "Sam",
  packageId: "p1",
  warned: false,
  accepted: false,
  ready: true,
  readError: null,
  ...over,
});

const FIELDS = {
  sessionType: "2on1" as const,
  instructorId: "i1",
  locationId: "l1",
  roomId: "r1",
  date: "2031-04-02",
  startTime: "09:00",
  endTime: "10:00",
  pay: "",
};

test("PT-107 saving sends each member with their package, and override only when staff accepted a warning", () => {
  const plain = manualSessionBody(FIELDS, [seat({})], "admin");
  assert.ok(typeof plain !== "string");
  assert.deepStrictEqual(plain.members, [{ client_id: "c1", client_package_id: "p1" }]);
  assert.strictEqual(plain.override, undefined);
  assert.strictEqual(plain.instructor_id, "i1");
  assert.strictEqual(plain.instructor_pay_sgd, null);
  assert.strictEqual(plain.session_type, "2on1");
  assert.strictEqual(plain.starts_at, new Date("2031-04-02T09:00:00").toISOString());

  const accepted = manualSessionBody(
    FIELDS,
    [seat({}), seat({ clientId: "c2", packageId: "p2", warned: true, accepted: true })],
    "admin",
  );
  assert.ok(typeof accepted !== "string");
  assert.strictEqual(accepted.override, true);
  assert.strictEqual(accepted.members.length, 2);
});

test("PT-107 the instructor's save names no instructor and no pay: the route runs it as them, an admin prices it", () => {
  const body = manualSessionBody({ ...FIELDS, pay: "80" }, [seat({})], "instructor");
  assert.ok(typeof body !== "string");
  assert.strictEqual("instructor_id" in body, false);
  assert.strictEqual("instructor_pay_sgd" in body, false);
  const admin = manualSessionBody({ ...FIELDS, pay: "80" }, [seat({})], "admin");
  assert.ok(typeof admin !== "string");
  assert.strictEqual(admin.instructor_pay_sgd, 80);
});

test("PT-107 saving is refused with nobody on it, too many for the type, a member who can't pay, or a warning not accepted", () => {
  assert.strictEqual(manualSessionBody(FIELDS, [], "admin"), "Add at least one member.");
  assert.strictEqual(
    manualSessionBody({ ...FIELDS, sessionType: "1on1" }, [seat({}), seat({ clientId: "c2" })], "admin"),
    "A 1-on-1 takes one member. Remove one, or make it a 2-on-1.",
  );
  assert.strictEqual(
    manualSessionBody(FIELDS, [seat({ packageId: null })], "admin"),
    "Sam has no package that can pay. Remove them to save.",
  );
  assert.strictEqual(
    manualSessionBody(FIELDS, [seat({ ready: false })], "admin"),
    "Still reading Sam's packages.",
  );
  assert.strictEqual(
    manualSessionBody(FIELDS, [seat({ ready: false, packageId: null, readError: "That member's account is blocked." })], "admin"),
    "Sam can't be added: That member's account is blocked. Remove them to save.",
  );
  assert.strictEqual(
    manualSessionBody(FIELDS, [seat({ warned: true })], "admin"),
    "Sam's package needs Add anyway, or pick another.",
  );
});

test("PT-107 saving is refused, as the class form is, without a location, room, instructor or a time range", () => {
  assert.strictEqual(manualSessionBody({ ...FIELDS, roomId: "" }, [seat({})], "admin"), "Pick a location and room.");
  assert.strictEqual(manualSessionBody({ ...FIELDS, instructorId: "" }, [seat({})], "admin"), "Pick an instructor.");
  // The instructor route runs the session as the caller; nothing to pick.
  assert.ok(typeof manualSessionBody({ ...FIELDS, instructorId: "" }, [seat({})], "instructor") !== "string");
  assert.strictEqual(
    manualSessionBody({ ...FIELDS, endTime: "09:00" }, [seat({})], "admin"),
    "End time must be after start time.",
  );
  assert.strictEqual(manualSessionBody({ ...FIELDS, date: "" }, [seat({})], "admin"), "Pick a date.");
  assert.strictEqual(
    manualSessionBody({ ...FIELDS, pay: "-5" }, [seat({})], "admin"),
    "Instructor pay can't be negative.",
  );
});

test("PT-107 a refused create is worded from its code; a clash passes the backend's own sentence through", () => {
  assert.strictEqual(
    manualSessionErrorMessage(new ApiError(409, { error: "insufficient_pt_credit" })),
    "That package has no sessions left.",
  );
  assert.strictEqual(
    manualSessionErrorMessage(new ApiError(403, { error: "bound_to_other_instructor" })),
    "That package is bound to another instructor. Ask an admin to add this member.",
  );
  assert.strictEqual(
    manualSessionErrorMessage(new ApiError(409, { error: "schedule_conflict", message: "Studio A is booked by Flow." })),
    "Studio A is booked by Flow.",
  );
  assert.strictEqual(
    manualSessionErrorMessage(new ApiError(400, { error: "room_location_mismatch" })),
    "That room belongs to a different location.",
  );
  assert.strictEqual(manualSessionErrorMessage(new ApiError(500, null)), "Couldn't create the session (HTTP 500).");
});

/* ── after it exists: the detail page (#338) ── */

const attendee = (id: string, isRequester: boolean) => ({ id, name: id === "c1" ? "Sam" : "Kim", is_requester: isRequester });

test("PT-111 adding a member sends their package, and override only when staff accepted a warning; one who can't pay is refused", () => {
  assert.deepStrictEqual(addMemberBody(seat({})), { client_id: "c1", client_package_id: "p1" });
  assert.deepStrictEqual(addMemberBody(seat({ warned: true, accepted: true })), {
    client_id: "c1",
    client_package_id: "p1",
    override: true,
  });
  assert.strictEqual(addMemberBody(seat({ warned: true })), "Sam's package needs Add anyway, or pick another.");
  assert.strictEqual(addMemberBody(seat({ packageId: null })), "Sam has no package that can pay.");
  assert.strictEqual(addMemberBody(seat({ ready: false })), "Still reading Sam's packages.");
  assert.strictEqual(
    addMemberBody(seat({ ready: false, packageId: null, readError: "That member's account is blocked." })),
    "Sam can't be added: That member's account is blocked.",
  );
});

test("PT-111 a seat is free to fill only on an active manual session with fewer members than its type seats", () => {
  const session = { origin: "portal" as const, lifecycle: "active" as const, session_type: "2on1" as const };
  assert.strictEqual(canAddMember({ ...session, clients: [attendee("c1", true)] }), true);
  assert.strictEqual(canAddMember({ ...session, clients: [attendee("c1", true), attendee("c2", false)] }), false);
  assert.strictEqual(canAddMember({ ...session, session_type: "1on1", clients: [] }), true);
  assert.strictEqual(canAddMember({ ...session, origin: "member", clients: [attendee("c1", true)] }), false);
  assert.strictEqual(canAddMember({ ...session, lifecycle: "cancelled", clients: [attendee("c1", true)] }), false);
  assert.strictEqual(isManual({ origin: "portal" }), true);
  assert.strictEqual(isManual({ origin: "member" }), false);
  assert.strictEqual(isManual({ origin: null }), false);
});

test("PT-112 a downgrade to 1-on-1 names the partner it takes off; the request's client stays", () => {
  const both = [attendee("c1", false), attendee("c2", true)];
  assert.deepStrictEqual(downgradeLeaving(both).map((c) => c.id), ["c1"]);
  assert.strictEqual(
    downgradeConfirm(both),
    "Change this session to 1-on-1? Sam is taken off it and gets their session back on their own package.",
  );
  assert.deepStrictEqual(downgradeLeaving([attendee("c2", true)]), []);
  assert.strictEqual(downgradeConfirm([attendee("c2", true)]), "Change this session to 1-on-1?");
});

test("PT-112 a downgrade sends only the type; an upgrade needs the partner, who pays from their own package", () => {
  assert.deepStrictEqual(retypeBody("1on1", null), { session_type: "1on1" });
  assert.strictEqual(retypeBody("2on1", null), "Add the partner who joins the 2-on-1.");
  assert.deepStrictEqual(retypeBody("2on1", seat({ clientId: "c2", packageId: "p2" })), {
    session_type: "2on1",
    co_client_id: "c2",
    co_client_package_id: "p2",
  });
  assert.deepStrictEqual(retypeBody("2on1", seat({ warned: true, accepted: true })), {
    session_type: "2on1",
    co_client_id: "c1",
    co_client_package_id: "p1",
    override: true,
  });
  assert.strictEqual(retypeBody("2on1", seat({ warned: true })), "Sam's package needs Add anyway, or pick another.");
});

test("PT-113 a refused remove, add, type change or cancel is worded from its code", () => {
  const says = (status: number, error: string) => sessionActionErrorMessage(new ApiError(status, { error }), "Couldn't remove them");
  assert.strictEqual(says(409, "booking_attended"), "That member has checked in, so their seat can't be given back.");
  assert.strictEqual(says(409, "session_ended"), "This session has ended, so its members can't change.");
  assert.strictEqual(says(409, "session_cancelled"), "This session has been cancelled.");
  assert.strictEqual(says(403, "not_your_session"), "This session is not one you are teaching.");
  assert.strictEqual(says(409, "not_a_manual_session"), "Only a session staff added manually can change its members.");
  assert.strictEqual(says(404, "booking_not_found"), "That member is no longer on this session.");
  assert.strictEqual(says(400, "partner_required"), "Add the partner who joins the 2-on-1.");
  assert.strictEqual(says(409, "session_full"), "This session has no free seat.");
  assert.strictEqual(says(409, "cannot_cancel"), "This session can no longer be cancelled.");
  // The seat rule's refusals read as they do on create.
  assert.strictEqual(says(409, "insufficient_pt_credit"), "That package has no sessions left.");
  assert.strictEqual(says(500, "boom"), "Couldn't remove them (HTTP 500).");
  assert.strictEqual(sessionActionErrorMessage(new Error("offline"), "Couldn't remove them"), "Network error");
});

test("PT-113 cancelling a manual session says each member is paid back on their own package", () => {
  assert.strictEqual(
    ptCancelConfirm({ origin: "portal" }),
    "Cancel this private session? Each member gets their session back on the package it was paid from.",
  );
  assert.strictEqual(
    ptCancelConfirm({ origin: "member" }),
    "Cancel this private session? Customer bookings will be cancelled and credits returned.",
  );
});
