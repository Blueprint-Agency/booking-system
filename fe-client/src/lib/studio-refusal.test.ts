import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { noteStudioRefusal, onStudioRefusal, pausedByStatus, studioRefusal, type StudioRefusal } from "./studio-refusal.ts";

afterEach(() => onStudioRefusal(null));

const SUSPENDED = { error: "tenant_suspended", status: "suspended" };
const MISMATCH = { error: "tenant_mismatch" };

test("SUP-34 a 403 tenant_suspended answer is the studio paused", () => {
  assert.equal(studioRefusal(403, SUSPENDED), "paused");
  assert.equal(studioRefusal(403, { error: "tenant_suspended" }), "paused");
});

test("SUP-34 a studio whose status, read by its slug, is anything but active is paused", () => {
  assert.equal(pausedByStatus("suspended"), true);
  assert.equal(pausedByStatus("archived"), true);
  assert.equal(pausedByStatus("active"), false);
});

test("SUP-35 a 403 tenant_mismatch answer is a session from another studio", () => {
  assert.equal(studioRefusal(403, MISMATCH), "other-studio");
});

test("SUP-34, SUP-35 anything else is neither: another 403, a 401, maintenance, no body", () => {
  assert.equal(studioRefusal(403, { error: "client_blocked" }), null);
  assert.equal(studioRefusal(403, { error: "forbidden_role" }), null);
  assert.equal(studioRefusal(401, { error: "invalid_token" }), null);
  assert.equal(studioRefusal(401, SUSPENDED), null);
  assert.equal(studioRefusal(503, { error: "maintenance", message: "Back soon" }), null);
  assert.equal(studioRefusal(403, null), null);
  assert.equal(studioRefusal(403, "Forbidden"), null);
});

test("SUP-34, SUP-35 noting a refusal tells the app what it means, with the token it refused; anything else does not", () => {
  const seen: StudioRefusal[] = [];
  onStudioRefusal((refusal) => seen.push(refusal));
  assert.equal(noteStudioRefusal(500, { error: "internal_error" }, "tok-a"), false);
  assert.equal(noteStudioRefusal(401, { error: "invalid_token" }, "tok-a"), false);
  assert.equal(noteStudioRefusal(403, SUSPENDED, "tok-a"), true);
  assert.equal(noteStudioRefusal(403, MISMATCH, "tok-b"), true);
  assert.equal(noteStudioRefusal(403, MISMATCH), true);
  assert.deepEqual(seen, [
    { kind: "paused" },
    { kind: "other-studio", sentToken: "tok-b" },
    { kind: "other-studio", sentToken: undefined },
  ]);
});
