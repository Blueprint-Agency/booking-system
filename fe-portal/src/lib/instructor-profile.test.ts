import test from "node:test";
import assert from "node:assert";
import { profileSaveError } from "./instructor-profile";
import { ApiError } from "./api";

test("STF-41 a refused profile save shows the backend's sentence, not a bare HTTP status", () => {
  assert.strictEqual(
    profileSaveError(
      new ApiError(400, { error: "invalid_request", message: "A bio is at most 2000 characters." }),
    ),
    "A bio is at most 2000 characters.",
  );
  assert.strictEqual(profileSaveError(new ApiError(500, null)), "Couldn't save (HTTP 500)");
  assert.strictEqual(profileSaveError(new TypeError("fetch failed")), "Couldn't save");
  assert.strictEqual(
    profileSaveError(new ApiError(403, { error: "forbidden_permission", required: "manage_rosters" })),
    "You do not have permission for this. Ask an admin.",
  );
});
