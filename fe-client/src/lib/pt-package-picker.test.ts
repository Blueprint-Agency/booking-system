import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialPtPick,
  ptLatestDate,
  ptLatestEnd,
  ptPickRows,
  ptSlotEndProblem,
  ptSlotStart,
  type PtPickable,
} from "./pt-package-picker.ts";

const SG = "Asia/Singapore";
const SYDNEY = "Australia/Sydney";

const pt = (over: Partial<PtPickable>): PtPickable => ({
  id: "p",
  kind: "pt",
  name: "PT Bundle of 10",
  creditsOrSessionsRemaining: 10,
  expiresAt: null,
  dormant: true,
  validityDays: 90,
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
    SG,
  );
  assert.deepEqual(rows.map((r) => r.pkg.id), ["a"]);
});

test("a package with fewer sessions than the request needs is greyed with the reason", () => {
  const [short, enough] = ptPickRows(
    [pt({ id: "short", sessionType: "2on1", creditsOrSessionsRemaining: 1 }), pt({ id: "ok", sessionType: "2on1", creditsOrSessionsRemaining: 4 })],
    "2on1",
    2,
    SG,
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
    SG,
  );
  assert.equal(dormant!.meta, "20 sessions left · starts when your first session is scheduled");
  assert.match(running!.meta, /^1 session left · until /);
});

const NOW = Date.parse("2026-11-01T02:00:00.000Z");
const at = (proposedDate: string, startTime: string) => ptSlotStart({ proposedDate, startTime }, SG);

test("PT-144 a package that runs out before the last proposed time is greyed with when it ends, judged by the instant on the expiry day; a Dormant one by its length from now", () => {
  const expiry = "2026-11-24T01:00:00.000Z";
  const running = pt({ id: "r", dormant: false, expiresAt: expiry });
  const shortDormant = pt({ id: "d", validityDays: 3 });

  const [late, lapses] = ptPickRows([running, shortDormant], "1on1", 1, SG, at("2026-11-24", "09:30"), NOW);
  assert.equal(late!.eligible, false);
  assert.equal(late!.reason, "Runs until 9:00 am on Tue 24 Nov, before one of your times");
  assert.equal(lapses!.eligible, false);
  assert.equal(lapses!.reason, "Runs until 10:00 am on Wed 4 Nov, before one of your times");

  const [onTheDot, inTime] = ptPickRows([running, shortDormant], "1on1", 1, SG, at("2026-11-24", "09:00"), NOW);
  assert.equal(onTheDot!.eligible, true);
  assert.equal(inTime!.eligible, false);
  assert.equal(ptPickRows([shortDormant], "1on1", 1, SG, at("2026-11-04", "10:00"), NOW)[0]!.eligible, true);
});

test("TEN-91 a Sydney studio's proposed time and package end are read on Sydney's clock, with its daylight saving", () => {
  // 09:00 on Tue 24 November in Sydney is UTC+11 (daylight saving), 22:00 UTC on the 23rd.
  const expiry = "2026-11-23T22:00:00.000Z";
  assert.equal(ptSlotStart({ proposedDate: "2026-11-24", startTime: "09:00" }, SYDNEY), Date.parse(expiry));
  assert.equal(ptSlotStart({ proposedDate: "2026-11-24", startTime: "09:00" }, SG), Date.parse("2026-11-24T01:00:00.000Z"));
  const running = pt({ id: "r", dormant: false, expiresAt: expiry });
  const [late] = ptPickRows([running], "1on1", 1, SYDNEY, ptSlotStart({ proposedDate: "2026-11-24", startTime: "09:30" }, SYDNEY), NOW);
  assert.equal(late!.reason, "Runs until 9:00 am on Tue 24 Nov, before one of your times");
  const latestEnd = ptLatestEnd([running], SYDNEY, NOW);
  assert.equal(
    ptSlotEndProblem({ proposedDate: "2026-11-24", startTime: "09:30" }, 1, latestEnd, SYDNEY),
    "Time 1: no package of yours runs past 9:00 am on Tue 24 Nov. Pick a time by then.",
  );
  // The package's last day is Sydney's 24th, though it is still the 23rd in UTC.
  assert.equal(ptLatestDate(undefined, latestEnd, SYDNEY), "2026-11-24");
  assert.equal(ptLatestDate(undefined, latestEnd, "UTC"), "2026-11-23");
});

test("TEN-92 a Dormant package's end counts its validity in calendar days on the studio's clock, across a daylight-saving start", () => {
  // 20:00 on Sat 3 Oct 2026 in Sydney; three days on is 20:00 on the 6th, 71 hours later.
  const now = Date.parse("2026-10-03T10:00:00.000Z");
  const [row] = ptPickRows([pt({ validityDays: 3 })], "1on1", 1, SYDNEY, Date.parse("2026-10-06T09:30:00.000Z"), now);
  assert.equal(row!.reason, "Runs until 8:00 pm on Tue 6 Oct, before one of your times");
});

test("PT-144 a time after the furthest any package runs is named before sending, and the date picker stops at that day or the window's last, whichever is sooner", () => {
  const latestEnd = ptLatestEnd([pt({ dormant: false, expiresAt: "2026-11-24T01:00:00.000Z" }), pt({ validityDays: 3 })], SG, NOW);
  assert.equal(latestEnd, Date.parse("2026-11-24T01:00:00.000Z"));
  assert.equal(
    ptSlotEndProblem({ proposedDate: "2026-11-24", startTime: "09:30" }, 2, latestEnd, SG),
    "Time 2: no package of yours runs past 9:00 am on Tue 24 Nov. Pick a time by then.",
  );
  assert.equal(ptSlotEndProblem({ proposedDate: "2026-11-24", startTime: "09:00" }, 2, latestEnd, SG), null);
  assert.equal(ptSlotEndProblem({ proposedDate: "2026-12-30", startTime: "09:00" }, 1, null, SG), null);

  assert.equal(ptLatestDate("2026-11-30", latestEnd, SG), "2026-11-24");
  assert.equal(ptLatestDate("2026-11-08", latestEnd, SG), "2026-11-08");
  assert.equal(ptLatestDate(undefined, latestEnd, SG), "2026-11-24");
  assert.equal(ptLatestDate("2026-11-08", null, SG), "2026-11-08");
});

test("the first package that can pay starts ticked; none when nothing can", () => {
  const rows = ptPickRows([pt({ id: "empty", creditsOrSessionsRemaining: 0 }), pt({ id: "full" })], "1on1", 1, SG);
  assert.equal(initialPtPick(rows), "full");
  assert.equal(initialPtPick(ptPickRows([pt({ creditsOrSessionsRemaining: 0 })], "1on1", 1, SG)), null);
});
