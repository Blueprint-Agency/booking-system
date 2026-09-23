import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api";
import {
  checkInErrorMessage,
  createScanGate,
  pickActiveSession,
  sessionPhase,
  type CheckInSession,
} from "./check-in";

const at = (hhmm: string) => new Date(`2026-09-22T${hhmm}:00Z`);

function session(id: string, start: string, end: string, opensBefore = 30): CheckInSession {
  const startsAt = at(start);
  return {
    kind: "class",
    id,
    name: `Class ${id}`,
    starts_at: startsAt.toISOString(),
    ends_at: at(end).toISOString(),
    check_in_opens_at: new Date(startsAt.getTime() - opensBefore * 60_000).toISOString(),
    location: null,
    room: null,
    instructor: null,
    roster: [],
  };
}

const morning = session("a", "07:00", "08:00");
const noon = session("b", "12:00", "13:00");
const evening = session("c", "18:00", "19:00");
const day = [evening, morning, noon];

test("the desk opens on the session running now", () => {
  assert.equal(pickActiveSession(day, at("12:20")), "class:b");
});

test("between sessions, it opens on the next to start", () => {
  assert.equal(pickActiveSession(day, at("09:00")), "class:b");
  assert.equal(pickActiveSession(day, at("06:00")), "class:a");
});

test("after the last session, it opens on the last of the day", () => {
  assert.equal(pickActiveSession(day, at("21:00")), "class:c");
});

test("two sessions running at once: the later-starting one, whose members are still arriving", () => {
  const overlap = session("d", "12:30", "13:30");
  assert.equal(pickActiveSession([noon, overlap], at("12:40")), "class:d");
});

test("no sessions, nothing selected", () => {
  assert.equal(pickActiveSession([], at("12:00")), null);
});

test("a session's phase follows the Check-in Window the server sent", () => {
  assert.equal(sessionPhase(noon, at("11:00")), "not_open");
  assert.equal(sessionPhase(noon, at("11:30")), "open");
  assert.equal(sessionPhase(noon, at("12:00")), "ongoing");
  assert.equal(sessionPhase(noon, at("13:00")), "ended");
});

test("a refusal shows the server's own sentence", () => {
  const err = new ApiError(422, {
    error: "check_in_not_open",
    message: "Check-in for Class b opens at 11:30.",
  });
  assert.equal(checkInErrorMessage(err, "Couldn't check in"), "Check-in for Class b opens at 11:30.");
});

test("a refusal with no sentence falls back, naming the status", () => {
  assert.equal(
    checkInErrorMessage(new ApiError(500, null), "Couldn't check in"),
    "Couldn't check in (HTTP 500).",
  );
  assert.match(checkInErrorMessage(new TypeError("fetch failed"), "Couldn't check in"), /connection/);
});

test("the camera's scan gate submits a QR once while it is held in view", () => {
  const gate = createScanGate(3000);
  assert.equal(gate.admit("tok-1", 0), true);
  assert.equal(gate.admit("tok-1", 200), false);
  // Still in view: every sighting extends the quiet.
  assert.equal(gate.admit("tok-1", 3100), false);
  // Out of view long enough — a deliberate re-scan goes through.
  assert.equal(gate.admit("tok-1", 6200), true);
});

test("a different member's QR goes straight through", () => {
  const gate = createScanGate(3000);
  assert.equal(gate.admit("tok-1", 0), true);
  assert.equal(gate.admit("tok-2", 100), true);
  assert.equal(gate.admit("tok-1", 200), true);
});

test("reset lets the same QR through at once", () => {
  const gate = createScanGate(3000);
  assert.equal(gate.admit("tok-1", 0), true);
  gate.reset();
  assert.equal(gate.admit("tok-1", 10), true);
});
