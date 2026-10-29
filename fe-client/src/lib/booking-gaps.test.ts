import { test } from "node:test";
import assert from "node:assert/strict";
import { missingSentence, partitionReads, type BookingKind } from "./booking-gaps.ts";

const ok = (value: unknown): PromiseFulfilledResult<unknown> => ({ status: "fulfilled", value });
const bad = (): PromiseRejectedResult => ({ status: "rejected", reason: new Error("500") });

const BOOKINGS: BookingKind[] = ["pt", "workshops", "corporate", "waitlist"];
const UP_NEXT: BookingKind[] = ["past", "pt", "workshops"];

function reads(kinds: BookingKind[], failing: BookingKind[]) {
  return Object.fromEntries(kinds.map((k) => [k, failing.includes(k) ? bad() : ok(`${k} rows`)]));
}

test("ACC-64 My bookings: with every optional read loaded, nothing is missing", () => {
  const { loaded, missing } = partitionReads(reads(BOOKINGS, []));
  assert.deepEqual(missing, []);
  assert.deepEqual(loaded, {
    pt: "pt rows",
    workshops: "workshops rows",
    corporate: "corporate rows",
    waitlist: "waitlist rows",
  });
});

for (const kind of BOOKINGS) {
  test(`ACC-64 My bookings: a failed ${kind} read alone is the one kind missing, the rest loaded`, () => {
    const { loaded, missing } = partitionReads(reads(BOOKINGS, [kind]));
    assert.deepEqual(missing, [kind]);
    assert.equal(kind in loaded, false);
    assert.deepEqual(Object.keys(loaded).sort(), BOOKINGS.filter((k) => k !== kind).sort());
  });
}

test("ACC-64 My bookings: with every optional read failed, all four kinds are missing, in a fixed order", () => {
  const { loaded, missing } = partitionReads(reads(BOOKINGS, ["waitlist", "corporate", "workshops", "pt"]));
  assert.deepEqual(missing, ["pt", "workshops", "corporate", "waitlist"]);
  assert.deepEqual(loaded, {});
});

test("ACC-64 an empty answer is a loaded one, not a missing one", () => {
  const { loaded, missing } = partitionReads({ pt: ok([]), waitlist: ok([]) });
  assert.deepEqual(missing, []);
  assert.deepEqual(loaded, { pt: [], waitlist: [] });
});

test("ACC-64 only the reads asked about are judged", () => {
  const { missing } = partitionReads({ corporate: bad() });
  assert.deepEqual(missing, ["corporate"]);
});

test("ACC-64 the line names each missing kind in plain words", () => {
  assert.equal(missingSentence([]), null);
  assert.equal(missingSentence(["pt"]), "Couldn't load your private sessions.");
  assert.equal(missingSentence(["pt", "workshops"]), "Couldn't load your private sessions and workshops.");
  assert.equal(missingSentence(["workshops"]), "Couldn't load your workshops.");
  assert.equal(missingSentence(["corporate"]), "Couldn't load your corporate requests.");
  assert.equal(missingSentence(["waitlist"]), "Couldn't load your waitlist.");
  assert.equal(
    missingSentence(["pt", "workshops", "corporate", "waitlist"]),
    "Couldn't load your private sessions, workshops, corporate requests and waitlist.",
  );
});

test("ACC-65 Up next: with every optional read loaded, nothing is missing", () => {
  assert.deepEqual(partitionReads(reads(UP_NEXT, [])).missing, []);
});

for (const kind of UP_NEXT) {
  test(`ACC-65 Up next: a failed ${kind} read alone is the one kind missing`, () => {
    const { loaded, missing } = partitionReads(reads(UP_NEXT, [kind]));
    assert.deepEqual(missing, [kind]);
    assert.equal(kind in loaded, false);
  });
}

test("ACC-65 Up next: with all three optional reads failed, past classes, private sessions and workshops are missing", () => {
  const { loaded, missing } = partitionReads(reads(UP_NEXT, UP_NEXT));
  assert.deepEqual(missing, ["pt", "workshops", "past"]);
  assert.deepEqual(loaded, {});
  assert.equal(missingSentence(missing), "Couldn't load your private sessions, workshops and past classes.");
});
