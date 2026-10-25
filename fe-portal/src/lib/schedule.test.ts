import test from "node:test";
import assert from "node:assert";
import { CLASS_CANCEL_CONFIRM, scheduleErrorMessage, fetchCorporateSession } from "./schedule";
import { seriesErrorMessage } from "./series";
import { manualSessionErrorMessage } from "./pt-manual";
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

// Schedule classes switched off while the page was open: the next create, series
// or cancel says it is a setting, not an HTTP status.
test("STF-35 a missing Instructor Permission reads as ask an admin, on every schedule call", () => {
  const refused = new ApiError(403, { error: "forbidden_permission", required: "schedule_classes" });
  const copy = "You do not have permission for this. Ask an admin.";
  assert.strictEqual(scheduleErrorMessage(refused, "Failed to create class"), copy);
  assert.strictEqual(seriesErrorMessage(refused, "Couldn't preview the dates"), copy);
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

// An edit that would move a class into the past, or end it before it starts,
// is refused in words the admin can act on, not a status (#246).
test("an edit into the past or with inverted times is explained without a status", () => {
  assert.strictEqual(
    scheduleErrorMessage(new ApiError(400, { error: "starts_at_in_past" })),
    "A class can't be moved to a time that has already passed. Pick a date and start time still to come.",
  );
  assert.strictEqual(
    scheduleErrorMessage(new ApiError(400, { error: "ends_at_must_be_after_starts_at" })),
    "End time must be after start time.",
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

test("PT-145 scheduling, moving or creating a private session after its package's expiry shows the backend's sentence, and its own copy without one, never a status", () => {
  const sentence =
    "The package paying for this session ends at 9:00 am on Tue 24 Nov 2026. Choose a time no later than that.";
  const withSentence = new ApiError(409, { error: "package_expires_before_session", message: sentence });
  const bare = new ApiError(409, { error: "package_expires_before_session" });
  const copy = "The package paying for this session runs out before that time. Choose an earlier time.";
  assert.strictEqual(scheduleErrorMessage(withSentence, "Couldn't schedule"), sentence);
  assert.strictEqual(manualSessionErrorMessage(withSentence), sentence);
  assert.strictEqual(scheduleErrorMessage(bare, "Couldn't schedule"), copy);
  assert.strictEqual(manualSessionErrorMessage(bare), copy);
});

test("CXL-70 cancelling a class promises no credit back to a refunded package", () => {
  assert.strictEqual(
    CLASS_CANCEL_CONFIRM,
    "Cancel this class? Every attendee's booking is cancelled, and the credits each one spent go back to their package, unless that package has been refunded.",
  );
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
