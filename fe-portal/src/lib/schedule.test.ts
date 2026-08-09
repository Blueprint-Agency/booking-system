import test from "node:test";
import assert from "node:assert";
import { scheduleErrorMessage, fetchCorporateSession } from "./schedule";
import { ApiError, type Api } from "./api";

// A clash is one code for both subjects, and the backend says who is taken by
// what — that sentence is the whole point, so it must survive to the screen.
test("a scheduling clash shows the backend's specific sentence", () => {
  assert.strictEqual(
    scheduleErrorMessage(
      new ApiError(409, {
        error: "schedule_conflict",
        subject: "instructor",
        message: "Anya is already booked — a class on 1 Jan, 18:00–19:00.",
      }),
    ),
    "Anya is already booked — a class on 1 Jan, 18:00–19:00.",
  );
});

// ...and if it ever arrives without one, the code still explains itself.
test("a clash with no message falls back to the code's copy", () => {
  assert.strictEqual(
    scheduleErrorMessage(new ApiError(409, { error: "schedule_conflict" })),
    "That room or instructor is already booked for an overlapping time.",
  );
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
