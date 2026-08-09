import test from "node:test";
import assert from "node:assert";
import { fetchActiveInstructors } from "./catalog";
import type { Api } from "./api";

// The module takes the backend handle as a parameter, so a stub handle is all
// this needs — no Clerk session, no React.
function stubApi(instructors: unknown[]): Api {
  return {
    get: async (path: string) => {
      assert.strictEqual(path, "/portal/admin/instructors");
      return { instructors };
    },
  } as unknown as Api;
}

// Archived instructors never reach a picker. The list route returns them, so
// this is the one rule the module exists to enforce.
test("archived instructors are dropped", async () => {
  const rows = await fetchActiveInstructors(
    stubApi([
      { id: "a", name: "Asha", archived_at: null },
      { id: "b", name: "Ben", archived_at: "2026-01-02T03:04:05.000Z" },
      { id: "c", name: "Cal", archived_at: null },
    ]),
  );
  assert.deepStrictEqual(
    rows.map((i) => i.id),
    ["a", "c"],
  );
});

// Pending invitees are not archived, so they stay schedulable.
test("pending invitees are kept", async () => {
  const rows = await fetchActiveInstructors(
    stubApi([{ id: "p", name: "Pia", status: "pending", archived_at: null }]),
  );
  assert.strictEqual(rows.length, 1);
});
