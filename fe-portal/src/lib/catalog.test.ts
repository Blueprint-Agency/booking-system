import test, { beforeEach } from "node:test";
import assert from "node:assert";
import { clearCatalogCache, fetchActiveInstructors } from "./catalog";
import type { Api } from "./api";

// The module caches responses per path; isolate each test from the last.
beforeEach(() => clearCatalogCache());

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

// Within the TTL, repeat reads reuse the first response instead of refetching.
test("responses are cached per path", async () => {
  let calls = 0;
  const api = {
    get: async () => {
      calls += 1;
      return { instructors: [{ id: "a", name: "Asha", archived_at: null }] };
    },
  } as unknown as Api;
  const [first, second] = await Promise.all([
    fetchActiveInstructors(api),
    fetchActiveInstructors(api),
  ]);
  await fetchActiveInstructors(api);
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(first, second);
});
