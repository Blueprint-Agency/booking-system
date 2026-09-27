import { test } from "node:test";
import assert from "node:assert/strict";
import { initialPtPick, ptPickRows, type PtPickable } from "./pt-package-picker.ts";

const pt = (over: Partial<PtPickable>): PtPickable => ({
  id: "p",
  kind: "pt",
  name: "PT Bundle of 10",
  creditsOrSessionsRemaining: 10,
  expiresAt: null,
  dormant: true,
  sessionType: "1on1",
  boundInstructor: null,
  ...over,
});

test("only PT packages of the request's session type are listed", () => {
  const rows = ptPickRows(
    [
      pt({ id: "a" }),
      pt({ id: "b", sessionType: "2on1" }),
      pt({ id: "c", kind: "credit_bundle", sessionType: null }),
    ],
    "1on1",
    1,
  );
  assert.deepEqual(rows.map((r) => r.pkg.id), ["a"]);
});

test("a package with fewer sessions than the request needs is greyed with the reason", () => {
  const [short, enough] = ptPickRows(
    [pt({ id: "short", sessionType: "2on1", creditsOrSessionsRemaining: 1 }), pt({ id: "ok", sessionType: "2on1", creditsOrSessionsRemaining: 4 })],
    "2on1",
    2,
  );
  assert.equal(short!.eligible, false);
  assert.equal(short!.reason, "Only 1 session left — this request needs 2");
  assert.equal(enough!.eligible, true);
  assert.equal(enough!.reason, null);
});

test("each row states its balance and where its clock stands", () => {
  const [dormant, running] = ptPickRows(
    [pt({ id: "d", creditsOrSessionsRemaining: 20 }), pt({ id: "r", dormant: false, expiresAt: "2026-12-31T00:00:00.000Z", creditsOrSessionsRemaining: 1 })],
    "1on1",
    1,
  );
  assert.equal(dormant!.meta, "20 sessions left · starts when your first session is scheduled");
  assert.match(running!.meta, /^1 session left · until /);
});

test("the first package that can pay starts ticked; none when nothing can", () => {
  const rows = ptPickRows([pt({ id: "empty", creditsOrSessionsRemaining: 0 }), pt({ id: "full" })], "1on1", 1);
  assert.equal(initialPtPick(rows), "full");
  assert.equal(initialPtPick(ptPickRows([pt({ creditsOrSessionsRemaining: 0 })], "1on1", 1)), null);
});
