import test from "node:test";
import assert from "node:assert";
import { scheduleErrorMessage, fetchCorporateSession } from "./schedule";
import { ApiError, type Api } from "./api";

// A room clash reads the same sentence whichever kind of event hit it — the
// backend spells it `room_clash` on classes and workshops and `room_conflict`
// on PT and corporate.
test("both spellings of a room clash give the same sentence", () => {
  const expected =
    "That room is already booked for an overlapping time. Pick another room or time.";
  assert.strictEqual(scheduleErrorMessage(new ApiError(409, { error: "room_clash" })), expected);
  assert.strictEqual(scheduleErrorMessage(new ApiError(409, { error: "room_conflict" })), expected);
});

test("a known code is explained without a status", () => {
  assert.strictEqual(
    scheduleErrorMessage(new ApiError(400, { error: "room_location_mismatch" })),
    "That room belongs to a different location.",
  );
});

// An unknown code still says which action failed, in the caller's words.
test("an unknown code falls back to the named action", () => {
  assert.strictEqual(
    scheduleErrorMessage(new ApiError(500, { error: "kaboom" }), "Failed to create class"),
    "Failed to create class (HTTP 500).",
  );
  assert.strictEqual(scheduleErrorMessage(new ApiError(500, null)), "Save failed (HTTP 500).");
});

test("a thrown non-response is a network error", () => {
  assert.strictEqual(scheduleErrorMessage(new TypeError("fetch failed")), "Network error");
});

// The corporate read is the odd envelope on this surface; callers get the row.
test("the corporate session envelope is unwrapped", async () => {
  const api = {
    get: async (path: string) => {
      assert.strictEqual(path, "/portal/admin/corporate-sessions/s1");
      return { corporate_session: { id: "s1", client_name: "Acme" } };
    },
  } as unknown as Api;
  assert.strictEqual((await fetchCorporateSession(api, "s1")).client_name, "Acme");
});
