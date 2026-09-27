import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import {
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
