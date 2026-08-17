import test from "node:test";
import assert from "node:assert";
import {
  fetchInstructorPayroll,
  payrollErrorMessage,
  payrollNeedsReload,
} from "./payroll";
import { ApiError, type Api } from "./api";

// Captures the one request the module makes — no Clerk session, no React.
function spyApi(seen: { path?: string; query?: unknown }): Api {
  return {
    get: async (path: string, query?: unknown) => {
      seen.path = path;
      seen.query = query;
      return {};
    },
  } as unknown as Api;
}

// An instructor's identity is the backend's to decide. If this screen ever sent
// one, an instructor could ask for somebody else's pay.
test("the instructor read carries no instructor_id", async () => {
  const seen: { path?: string; query?: unknown } = {};
  await fetchInstructorPayroll(spyApi(seen), { from: "2026-03-01", to: "2026-03-31" });
  assert.strictEqual(seen.path, "/portal/instructor/payroll");
  assert.ok(!Object.keys(seen.query as object).includes("instructor_id"));
});

// The backend names which KIND of record vanished; that beats the local copy.
test("a vanished session shows the backend's specific sentence", () => {
  assert.strictEqual(
    payrollErrorMessage(
      new ApiError(404, {
        error: "record_not_found",
        message: "That private session no longer exists — it was deleted or cancelled.",
      }),
    ),
    "That private session no longer exists — it was deleted or cancelled.",
  );
});

// The four reasons must not collapse back into one message on the screen.
test("each reason reads differently even without a backend message", () => {
  const codes = [
    "record_not_found",
    "instructor_not_assigned",
    "invalid_amount",
    "instructor_required",
  ];
  const seen = codes.map((error) => payrollErrorMessage(new ApiError(404, { error })));
  assert.strictEqual(new Set(seen).size, codes.length);
  assert.ok(seen.every((m) => !m.includes("HTTP")));
});

test("an unknown code falls back to the named action", () => {
  assert.strictEqual(
    payrollErrorMessage(new ApiError(500, { error: "kaboom" }), "Couldn't delete"),
    "Couldn't delete (HTTP 500).",
  );
});

test("a thrown non-response is a network error", () => {
  assert.strictEqual(payrollErrorMessage(new Error("offline")), "Network error");
});

// Only a stale row forces a reload — a rejected amount keeps the typed draft.
test("only 404/409 mean the list on screen is stale", () => {
  assert.strictEqual(payrollNeedsReload(new ApiError(404, { error: "record_not_found" })), true);
  assert.strictEqual(
    payrollNeedsReload(new ApiError(409, { error: "instructor_not_assigned" })),
    true,
  );
  assert.strictEqual(payrollNeedsReload(new ApiError(400, { error: "invalid_amount" })), false);
  assert.strictEqual(payrollNeedsReload(new Error("offline")), false);
});
