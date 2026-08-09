import test from "node:test";
import assert from "node:assert";
import {
  fetchAdminPayroll,
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

// The period is the whole reason the reads live in the module: both screens
// hand over the same DateRange and must end up asking for the same span, or a
// total lands next to rows from a different period.
test("both payroll reads turn one period into the same from/to", async () => {
  const range = { from: "2026-03-01", to: "2026-03-31" };
  const admin: { query?: unknown } = {};
  const instructor: { query?: unknown } = {};
  await fetchAdminPayroll(spyApi(admin), { range });
  await fetchInstructorPayroll(spyApi(instructor), range);
  const a = admin.query as { from: string; to: string };
  const i = instructor.query as { from: string; to: string };
  assert.strictEqual(a.from, i.from);
  assert.strictEqual(a.to, i.to);
  assert.ok(a.from < a.to);
});

// "All instructors" is an empty string in the picker; sending it as a filter is
// a 400 from the uuid validator, not an unfiltered list.
test("unset filters are omitted, not sent blank", async () => {
  const seen: { query?: unknown } = {};
  await fetchAdminPayroll(spyApi(seen), { instructorId: "", classTypeId: "", range: null });
  assert.deepStrictEqual(seen.query, {
    instructor_id: undefined,
    class_type_id: undefined,
    from: undefined,
    to: undefined,
  });
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
