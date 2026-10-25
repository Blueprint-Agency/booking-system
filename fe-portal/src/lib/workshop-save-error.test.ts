import test from "node:test";
import assert from "node:assert";
import { workshopSaveError } from "./workshop-save-error";
import { ApiError } from "./api";

test("WSP-24 a refused workshop save shows a sentence, not a bare HTTP 409", () => {
  assert.strictEqual(
    workshopSaveError(new ApiError(409, { error: "workshop_day_has_bookings", bookings: 2 })),
    "This day has 2 confirmed bookings, so it can't be removed.",
  );
  assert.strictEqual(
    workshopSaveError(new ApiError(409, { error: "workshop_day_has_bookings", bookings: 1 })),
    "This day has 1 confirmed booking, so it can't be removed.",
  );
  assert.strictEqual(
    workshopSaveError(
      new ApiError(409, {
        error: "workshop_tier_has_bookings",
        bookings: 1,
        message: "This tier has 1 confirmed booking, so it can't be removed.",
      }),
    ),
    "This tier has 1 confirmed booking, so it can't be removed.",
  );
  assert.strictEqual(
    workshopSaveError(
      new ApiError(409, {
        error: "workshop_tier_required",
        message: "A workshop needs at least one tier, so its last tier can't be removed.",
      }),
    ),
    "A workshop needs at least one tier, so its last tier can't be removed.",
  );
  assert.strictEqual(workshopSaveError(new ApiError(500, null)), "Save failed (HTTP 500).");
});
